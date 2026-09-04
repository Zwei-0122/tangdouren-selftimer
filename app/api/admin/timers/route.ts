// POST /api/admin/timers  — 创建计时订单
// GET  /api/admin/timers  — 获取计时订单列表（管理员）
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { generateTimerSessionId } from '@/lib/timer/sessionId'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  let body: { bookingId?: string; customerName?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const { bookingId, customerName } = body

  if (!customerName?.trim() && !bookingId) {
    return NextResponse.json({ error: '请填写顾客姓名或关联预约' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 如果关联了预约，获取顾客姓名和桌号
  let resolvedName = customerName?.trim() ?? ''
  let tableNumber: string | null = null
  if (bookingId && !resolvedName) {
    const { data: booking } = await admin
      .from('bookings')
      .select('customer_name, assigned_table_code')
      .eq('booking_id', bookingId)
      .single()
    resolvedName = booking?.customer_name ?? ''
    tableNumber  = booking?.assigned_table_code ?? null
  } else if (bookingId) {
    const { data: booking } = await admin
      .from('bookings')
      .select('assigned_table_code')
      .eq('booking_id', bookingId)
      .single()
    tableNumber = booking?.assigned_table_code ?? null
  }

  const sessionId = await generateTimerSessionId(admin)

  const { data, error } = await admin
    .from('timer_sessions')
    .insert({
      session_id:    sessionId,
      booking_id:    bookingId ?? null,
      customer_name: resolvedName,
      table_number:  tableNumber,
      status:        'idle',
      created_via:   bookingId ? 'booking' : 'admin',
      created_by:    user.email ?? user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/admin/timers]', error)
    return NextResponse.json({ error: '创建失败，请稍后重试' }, { status: 500 })
  }

  return NextResponse.json({ session: data }, { status: 201 })
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status')  // running | paused | completed | all

  const admin = createAdminClient()
  let query = admin
    .from('timer_sessions')
    .select('*, bookings(booking_date, start_time, end_time)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ sessions: data })
}
