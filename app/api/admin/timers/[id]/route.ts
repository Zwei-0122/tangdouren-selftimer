// PATCH /api/admin/timers/[id]  — 暂停 / 继续 / 结束计时
// GET   /api/admin/timers/[id]  — 获取单条计时详情（管理员）
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calcBillingMinutes, calcBill } from '@/lib/timer/pricing'
import { resolveActiveSeatCodeFromValue } from '@/lib/timer/selfService'

type Action = 'start' | 'pause' | 'resume' | 'stop' | 'settle' | 'update_table'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { id } = await params
  const admin   = createAdminClient()

  const { data, error } = await admin
    .from('timer_sessions')
    .select('*, bookings(customer_name, booking_date, start_time, end_time)')
    .eq('session_id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: '计时订单不存在' }, { status: 404 })
  return NextResponse.json({ session: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { id } = await params
  const admin  = createAdminClient()

  const { error } = await admin
    .from('timer_sessions')
    .delete()
    .eq('session_id', id)

  if (error) {
    console.error('[DELETE /api/admin/timers]', error)
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { id }   = await params
  const body     = await request.json() as { action: Action; actual_amount_gbp?: number; actual_amount_cny?: number; settlement_note?: string; table_number?: string }
  const { action } = body

  if (!['start', 'pause', 'resume', 'stop', 'settle', 'update_table'].includes(action)) {
    return NextResponse.json({ error: '无效操作' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: session, error: fetchErr } = await admin
    .from('timer_sessions')
    .select('*')
    .eq('session_id', id)
    .single()

  if (fetchErr || !session) return NextResponse.json({ error: '计时订单不存在' }, { status: 404 })
  if (session.status !== 'completed' && action === 'settle') {
    return NextResponse.json({ error: '请先结束计时再结算' }, { status: 409 })
  }
  if (action === 'update_table') {
    const tableNumber = body.table_number ? await resolveActiveSeatCodeFromValue(admin, body.table_number) : null
    if (!tableNumber) return NextResponse.json({ error: '请输入有效座位号' }, { status: 400 })

    const { data: updated, error: updateErr } = await admin
      .from('timer_sessions')
      .update({ table_number: tableNumber })
      .eq('session_id', id)
      .select()
      .single()

    if (updateErr) {
      console.error('[update_table /api/admin/timers]', updateErr)
      return NextResponse.json({ error: '桌号更新失败' }, { status: 500 })
    }
    return NextResponse.json({ session: updated })
  }
  if (session.status === 'completed' && action !== 'settle') {
    return NextResponse.json({ error: '计时已结束' }, { status: 409 })
  }

  const now    = new Date()
  let update: Record<string, unknown> = {}

  // ── 结算 ────────────────────────────────────────────────────────────────────
  if (action === 'settle') {
    const actualGbp = body.actual_amount_gbp ?? session.amount_gbp
    update = {
      is_settled:        true,
      actual_amount_gbp: actualGbp,
      actual_amount_cny: body.actual_amount_cny ?? null,
      settlement_note:   body.settlement_note   ?? null,
      settled_at:        now.toISOString(),
      settled_by:        user.email ?? user.id,
    }

    const { data: updated, error: updateErr } = await admin
      .from('timer_sessions')
      .update(update)
      .eq('session_id', id)
      .select()
      .single()

    if (updateErr) {
      console.error('[settle /api/admin/timers]', updateErr)
      return NextResponse.json({ error: '结算失败' }, { status: 500 })
    }

    // 如果关联了预约，自动标记为已完成
    if (session.booking_id) {
      const bookingAdmin = createAdminClient()
      await bookingAdmin
        .from('bookings')
        .update({ status: 'completed' })
        .eq('booking_id', session.booking_id)
        .in('status', ['confirmed', 'payment_pending'])
    }

    return NextResponse.json({ session: updated })
  }

  if (action === 'start') {
    if (session.status !== 'idle') return NextResponse.json({ error: '计时已开始' }, { status: 409 })
    update = { status: 'running', started_at: now.toISOString() }

  } else if (action === 'pause') {
    if (session.status !== 'running') return NextResponse.json({ error: '当前不在计时中' }, { status: 409 })
    update = { status: 'paused', paused_at: now.toISOString() }

  } else if (action === 'resume') {
    if (session.status !== 'paused') return NextResponse.json({ error: '当前未处于暂停状态' }, { status: 409 })
    const pausedAt       = new Date(session.paused_at as string)
    const pauseDurationMs = now.getTime() - pausedAt.getTime()
    update = {
      status:          'running',
      paused_at:       null,
      total_paused_ms: (session.total_paused_ms ?? 0) + pauseDurationMs,
    }

  } else {
    // stop
    if (session.status === 'idle') return NextResponse.json({ error: '计时尚未开始' }, { status: 409 })
    // 计算实际用时（扣除暂停时间）
    let totalPausedMs = session.total_paused_ms ?? 0
    if (session.status === 'paused' && session.paused_at) {
      totalPausedMs += now.getTime() - new Date(session.paused_at as string).getTime()
    }
    const startedAt      = new Date(session.started_at as string)
    const totalElapsedMs = now.getTime() - startedAt.getTime() - totalPausedMs
    const elapsedMinutes = Math.floor(totalElapsedMs / 60000)
    const billingMinutes = calcBillingMinutes(elapsedMinutes)
    const bill           = calcBill(billingMinutes)

    // 获取实时汇率（GBP → CNY）
    let exchangeRate: number | null = null
    let amountCny:    number | null = null
    try {
      const rateRes  = await fetch('https://api.frankfurter.app/latest?from=GBP&to=CNY', { next: { revalidate: 3600 } })
      const rateData = await rateRes.json() as { rates: { CNY: number } }
      exchangeRate   = rateData.rates.CNY
      amountCny      = parseFloat((bill.totalGbp * exchangeRate).toFixed(2))
    } catch {
      console.warn('[timer stop] 汇率获取失败，跳过人民币换算')
    }

    update = {
      status:          'completed',
      stopped_at:      now.toISOString(),
      paused_at:       null,
      total_paused_ms: totalPausedMs,
      elapsed_minutes: elapsedMinutes,
      billing_minutes: billingMinutes,
      amount_gbp:      bill.totalGbp,
      amount_cny:      amountCny,
      exchange_rate:   exchangeRate,
      bill_breakdown:  bill.lines,
    }
  }

  const { data: updated, error: updateErr } = await admin
    .from('timer_sessions')
    .update(update)
    .eq('session_id', id)
    .select()
    .single()

  if (updateErr) {
    console.error('[PATCH /api/admin/timers]', updateErr)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }

  return NextResponse.json({ session: updated })
}
