'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { formatHMS, formatChineseDuration, calcBillingMinutes, calcBill, TIMER_PRICING } from '@/lib/timer/pricing'

interface TimerSession {
  session_id:         string
  booking_id:         string | null
  customer_name:      string
  status:             'idle' | 'running' | 'paused' | 'completed'
  started_at:         string | null
  paused_at:          string | null
  total_paused_ms:    number
  stopped_at:         string | null
  elapsed_minutes:    number | null
  billing_minutes:    number | null
  amount_gbp:         number | null
  amount_cny:         number | null
  exchange_rate:      number | null
  bill_breakdown:     { label: string; amount: number }[] | null
  created_by:         string | null
  table_number:       string | null
  created_via:        'admin' | 'booking' | 'self_service' | null
  // 结算字段
  is_settled:         boolean
  actual_amount_gbp:  number | null
  actual_amount_cny:  number | null
  settlement_note:    string | null
  settled_at:         string | null
  settled_by:         string | null
}

function calcElapsed(session: TimerSession): number {
  if (session.status === 'idle') return 0
  if (session.status === 'completed' && session.elapsed_minutes !== null) return session.elapsed_minutes * 60
  if (!session.started_at) return 0
  const started     = new Date(session.started_at).getTime()
  const totalPaused = session.total_paused_ms ?? 0
  if (session.status === 'paused' && session.paused_at) {
    return Math.max(0, (new Date(session.paused_at).getTime() - started - totalPaused) / 1000)
  }
  return Math.max(0, (Date.now() - started - totalPaused) / 1000)
}

export default function AdminTimerDetailPage() {
  const { id }                = useParams<{ id: string }>()
  const router                = useRouter()
  const [session, setSession] = useState<TimerSession | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [acting, setActing]   = useState(false)
  const [error, setError]     = useState('')
  const [tableEdit, setTableEdit] = useState('')
  const tickRef               = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSession = useCallback(async () => {
    const res  = await fetch(`/api/admin/timers/${id}`)
    if (!res.ok) { setError('找不到计时订单'); setLoading(false); return }
    const data = await res.json() as { session: TimerSession }
    setSession(data.session)
    setTableEdit(data.session.table_number ?? '')
    setElapsed(calcElapsed(data.session))
    setLoading(false)
  }, [id])

  useEffect(() => { fetchSession() }, [fetchSession])

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current)
    if (session?.status === 'running') {
      tickRef.current = setInterval(() => setElapsed(calcElapsed(session)), 1000)
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [session])

  async function doAction(action: 'start' | 'pause' | 'resume' | 'stop') {
    if (action === 'stop' && !confirm('确认结束计时？系统将自动计算账单。')) return
    setActing(true)
    const res  = await fetch(`/api/admin/timers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await res.json() as { session?: TimerSession; error?: string }
    if (!res.ok) { alert(data.error ?? '操作失败'); setActing(false); return }
    setSession(data.session!)
    setElapsed(calcElapsed(data.session!))
    setActing(false)
  }

  async function updateTable() {
    if (!tableEdit.trim()) { alert('请填写座位号'); return }
    setActing(true)
    const res  = await fetch(`/api/admin/timers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_table', table_number: tableEdit }),
    })
    const data = await res.json() as { session?: TimerSession; error?: string }
    if (!res.ok) { alert(data.error ?? '座位号更新失败'); setActing(false); return }
    setSession(data.session!)
    setTableEdit(data.session!.table_number ?? '')
    setActing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-stone-400">
          <div className="text-3xl mb-2 animate-spin">⏱</div>加载中…
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="p-6 text-center text-stone-400">
        <p>{error || '计时订单不存在'}</p>
        <button onClick={() => router.push('/dashboard/timers')} className="mt-4 text-sm text-terracotta hover:underline">
          ← 返回列表
        </button>
      </div>
    )
  }

  const isIdle      = session.status === 'idle'
  const isCompleted = session.status === 'completed'
  const isPaused    = session.status === 'paused'
  const isRunning   = session.status === 'running'

  const liveBillingMin = calcBillingMinutes(Math.floor(elapsed / 60))
  const liveBill       = calcBill(liveBillingMin)

  const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.tangdouren.co.uk'
  const sharePath = session.created_via === 'self_service'
    ? `/self-timer/session/${session.session_id}`
    : `/timer/${session.session_id}`
  const shareUrl = `${appUrl}${sharePath}`

  const statusColors: Record<string, string> = {
    idle:      'bg-stone-100 text-stone-500',
    running:   'bg-emerald-100 text-emerald-700',
    paused:    'bg-amber-100 text-amber-700',
    completed: 'bg-stone-100 text-stone-500',
  }
  const statusLabels: Record<string, string> = {
    idle: '未开始', running: '计时中', paused: '已暂停', completed: '已完成',
  }
  const sourceLabels: Record<string, string> = {
    admin: '后台创建', booking: '预约创建', self_service: '顾客自助',
  }

  return (
    <div className="max-w-lg mx-auto p-4 md:p-6 space-y-4">
      {/* Back */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.push('/dashboard/timers')} className="text-sm text-stone-400 hover:text-stone-600 flex items-center gap-1">
          ← 返回计时列表
        </button>
        <button
          onClick={async () => {
            if (!confirm(`确认删除订单 ${session.session_id}？此操作不可撤销。`)) return
            const res = await fetch(`/api/admin/timers/${id}`, { method: 'DELETE' })
            if (res.ok) router.push('/dashboard/timers')
            else alert('删除失败，请重试')
          }}
          className="text-xs text-red-400 hover:text-red-600 transition"
        >
          删除订单
        </button>
      </div>

      {/* Title */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-800">{session.session_id}</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {session.customer_name} · {session.table_number ?? '未填座位号'} · {sourceLabels[session.created_via ?? 'admin'] ?? '后台创建'}
          </p>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColors[session.status]}`}>
          {statusLabels[session.status]}
        </span>
      </div>

      {/* Table correction */}
      <div className="bg-white rounded-2xl border border-stone-100 px-5 py-4 shadow-sm">
        <p className="text-xs font-medium text-stone-400 uppercase mb-3">座位号</p>
        <div className="flex gap-2">
          <input
            value={tableEdit}
            onChange={e => setTableEdit(e.target.value.toUpperCase())}
            placeholder="例如 S1 / D2A / F1C"
            className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-terracotta/30 focus:border-terracotta"
          />
          <button
            onClick={updateTable}
            disabled={acting || tableEdit.trim().toUpperCase() === (session.table_number ?? '')}
            className="rounded-xl bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 transition"
          >
            保存
          </button>
        </div>
        <p className="text-xs text-stone-400 mt-2">用于处理顾客误选/误填座位号；S 为单人座，D 有 A/B，F 有 A/B/C/D。</p>
      </div>

      {/* Elapsed time */}
      <div className={`rounded-3xl p-6 text-center ${isCompleted ? 'bg-gradient-to-br from-green-50 to-emerald-100' : isPaused ? 'bg-gradient-to-br from-amber-50 to-orange-100' : isIdle ? 'bg-gradient-to-br from-stone-50 to-stone-100' : 'bg-gradient-to-br from-rose-50 to-terracotta/10'}`}>
        <p className="text-stone-400 text-xs mb-1">{isCompleted ? '实际用时' : isPaused ? '暂停时已用时' : isIdle ? '等待开始' : '已用时'}</p>
        <p className="text-5xl font-mono font-bold text-stone-800 tracking-wider tabular-nums">
          {isIdle ? '--:--:--' : formatHMS(elapsed)}
        </p>
        <p className="text-stone-500 text-sm mt-1">{isIdle ? '点击「开始计时」启动' : formatChineseDuration(elapsed)}</p>
        {!isCompleted && !isIdle && (
          <p className="text-xs text-stone-400 mt-2">
            计费时长：{liveBillingMin} min → <span className="font-semibold text-terracotta">£{liveBill.totalGbp.toFixed(2)}</span>（预估）
          </p>
        )}
      </div>

      {/* Controls */}
      {!isCompleted && (
        <div className="flex gap-3">
          {isIdle && (
            <button
              onClick={() => doAction('start')}
              disabled={acting}
              className="flex-1 py-3 rounded-2xl bg-terracotta text-white font-semibold text-sm hover:bg-terracotta/90 disabled:opacity-50 transition shadow-sm"
            >
              ▶ 开始计时
            </button>
          )}
          {isRunning && (
            <button
              onClick={() => doAction('pause')}
              disabled={acting}
              className="flex-1 py-3 rounded-2xl border-2 border-amber-300 text-amber-600 font-semibold text-sm hover:bg-amber-50 disabled:opacity-50 transition"
            >
              ⏸ 暂停计时
            </button>
          )}
          {isPaused && (
            <button
              onClick={() => doAction('resume')}
              disabled={acting}
              className="flex-1 py-3 rounded-2xl border-2 border-emerald-300 text-emerald-600 font-semibold text-sm hover:bg-emerald-50 disabled:opacity-50 transition"
            >
              ▶ 继续计时
            </button>
          )}
          {!isIdle && (
            <button
              onClick={() => doAction('stop')}
              disabled={acting}
              className="flex-1 py-3 rounded-2xl bg-terracotta text-white font-semibold text-sm hover:bg-terracotta/90 disabled:opacity-50 transition shadow-sm"
            >
              ⏹ 结束计时
            </button>
          )}
        </div>
      )}

      {/* Final bill */}
      {isCompleted && session.bill_breakdown && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-4">
          <p className="text-xs font-medium text-stone-400 uppercase mb-3">最终账单</p>
          {session.bill_breakdown.map((l, i) => (
            <div key={i} className="flex justify-between py-1.5 border-b border-stone-100 last:border-0 text-sm">
              <span className="text-stone-600">{l.label}</span>
              <span className="font-medium">£{l.amount.toFixed(2)}</span>
            </div>
          ))}
          <div className="flex justify-between items-baseline pt-3 mt-1">
            <span className="font-semibold text-stone-700">
              应收（{session.billing_minutes} min）
            </span>
            <span className="text-2xl font-bold text-terracotta">£{session.amount_gbp?.toFixed(2)}</span>
          </div>
          {session.amount_cny && session.exchange_rate && (
            <p className="text-xs text-stone-400 text-right mt-1">
              ≈ ¥{session.amount_cny.toFixed(2)}（汇率 {session.exchange_rate.toFixed(4)}）
            </p>
          )}
        </div>
      )}

      {/* Settlement */}
      {isCompleted && (
        <SettlementPanel session={session} onSettled={fetchSession} />
      )}

      {/* Live bill preview (running) */}
      {!isCompleted && (
        <div className="bg-white rounded-2xl border border-stone-100 px-5 py-4">
          <p className="text-xs font-medium text-stone-400 uppercase mb-2">实时账单预览</p>
          {liveBill.lines.map((l, i) => (
            <div key={i} className="flex justify-between py-1 text-sm text-stone-600">
              <span>{l.label}</span><span className="font-medium">£{l.amount.toFixed(2)}</span>
            </div>
          ))}
          <div className="flex justify-between pt-2 mt-1 border-t border-stone-100">
            <span className="text-sm font-semibold text-stone-700">预计合计</span>
            <span className="text-lg font-bold text-terracotta">£{liveBill.totalGbp.toFixed(2)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-400">
            <span>首小时 £{TIMER_PRICING.firstHourGbp}</span>
            <span>续时 £{TIMER_PRICING.continuationPerHourGbp}/h</span>
            <span className="text-terracotta">2.5h套餐 £{TIMER_PRICING.package250hGbp}</span>
            <span className="text-terracotta">4h套餐 £{TIMER_PRICING.package400hGbp}</span>
          </div>
        </div>
      )}

      {/* Share link & QR */}
      <div className="bg-white rounded-2xl border border-stone-100 px-5 py-4">
        <p className="text-xs font-medium text-stone-400 uppercase mb-3">分享给顾客</p>
        <div className="flex items-center gap-2 bg-stone-50 rounded-xl px-3 py-2 mb-3">
          <span className="text-xs text-stone-500 break-all flex-1 font-mono">{shareUrl}</span>
          <button
            onClick={() => { navigator.clipboard.writeText(shareUrl); alert('链接已复制') }}
            className="text-xs text-terracotta hover:underline shrink-0"
          >
            复制
          </button>
        </div>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(shareUrl)}&size=160x160&margin=8`}
            alt="QR Code"
            className="w-40 h-40 rounded-xl border border-stone-100"
          />
        </div>
        <p className="text-center text-xs text-stone-400 mt-2">顾客扫码实时查看计时进度</p>
      </div>

      {/* Meta */}
      <div className="text-xs text-stone-400 space-y-0.5 pb-4">
        <p>开始时间：{session.started_at ? new Date(session.started_at).toLocaleString('zh-CN', { timeZone: 'Europe/London' }) : '未开始'}</p>
        {session.stopped_at && <p>结束时间：{new Date(session.stopped_at).toLocaleString('zh-CN', { timeZone: 'Europe/London' })}</p>}
        <p>操作员：{session.created_by ?? '—'}</p>
      </div>
    </div>
  )
}

// ── 结算面板 ─────────────────────────────────────────────────────────────────
function SettlementPanel({ session, onSettled }: { session: TimerSession; onSettled: () => void }) {
  const [actualGbp,  setActualGbp]  = useState(session.actual_amount_gbp?.toString() ?? session.amount_gbp?.toFixed(2) ?? '')
  const [note,       setNote]       = useState(session.settlement_note ?? '')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  // 已结算 → 只展示结果
  if (session.is_settled) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-emerald-600 text-lg">✅</span>
          <p className="text-sm font-semibold text-emerald-700">已结算</p>
          <span className="ml-auto text-xs text-stone-400">
            {session.settled_at ? new Date(session.settled_at).toLocaleString('zh-CN', { timeZone: 'Europe/London' }) : ''}
          </span>
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-500">应收</span>
            <span className="font-medium text-stone-700">£{session.amount_gbp?.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">实收</span>
            <span className="font-bold text-emerald-700 text-base">£{session.actual_amount_gbp?.toFixed(2)}</span>
          </div>
          {session.actual_amount_cny && (
            <div className="flex justify-between">
              <span className="text-stone-500">实收（人民币）</span>
              <span className="font-medium text-stone-700">¥{session.actual_amount_cny.toFixed(2)}</span>
            </div>
          )}
          {session.settlement_note && (
            <div className="mt-2 bg-white rounded-xl px-3 py-2 text-xs text-stone-500 border border-emerald-100">
              备注：{session.settlement_note}
            </div>
          )}
          {session.booking_id && (
            <p className="text-xs text-stone-400 mt-1">关联预约已自动标记为已完成</p>
          )}
          <p className="text-xs text-stone-400">结算人：{session.settled_by ?? '—'}</p>
        </div>
      </div>
    )
  }

  async function handleSettle() {
    const gbpVal = parseFloat(actualGbp)
    if (isNaN(gbpVal) || gbpVal < 0) { setError('请输入有效的实收金额'); return }
    setError('')
    setSaving(true)
    try {
      const res  = await fetch(`/api/admin/timers/${session.session_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:            'settle',
          actual_amount_gbp: gbpVal,
          settlement_note:   note || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '结算失败'); return }
      onSettled()
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-terracotta/30 focus:border-terracotta'

  return (
    <div className="bg-white border border-stone-100 rounded-2xl px-5 py-4 shadow-sm">
      <p className="text-xs font-semibold text-stone-400 uppercase mb-4">确认结算</p>

      {/* 订单摘要 */}
      <div className="bg-stone-50 rounded-xl px-4 py-3 mb-4 space-y-1.5 text-sm">
        <div className="flex justify-between text-stone-500">
          <span>客户</span>
          <span className="font-medium text-stone-700">{session.customer_name}</span>
        </div>
        <div className="flex justify-between text-stone-500">
          <span>订单号</span>
          <span className="font-mono text-xs text-stone-600">{session.session_id}</span>
        </div>
        <div className="flex justify-between text-stone-500">
          <span>计费时长</span>
          <span className="font-medium text-stone-700">{session.billing_minutes} 分钟</span>
        </div>
        {session.started_at && (
          <div className="flex justify-between text-stone-500">
            <span>开始时间</span>
            <span className="text-stone-600">{new Date(session.started_at).toLocaleString('zh-CN', { timeZone: 'Europe/London' })}</span>
          </div>
        )}
        {session.stopped_at && (
          <div className="flex justify-between text-stone-500">
            <span>结束时间</span>
            <span className="text-stone-600">{new Date(session.stopped_at).toLocaleString('zh-CN', { timeZone: 'Europe/London' })}</span>
          </div>
        )}
        <div className="flex justify-between pt-1.5 border-t border-stone-200">
          <span className="font-semibold text-stone-600">应收</span>
          <span className="font-bold text-terracotta text-base">£{session.amount_gbp?.toFixed(2)}</span>
        </div>
      </div>

      {/* 实收输入 */}
      <div className="mb-3">
        <label className="block text-xs text-stone-400 mb-1">实收金额（£）</label>
        <input
          type="number" step="0.01" min="0"
          className={inputCls}
          value={actualGbp}
          onChange={e => setActualGbp(e.target.value)}
          placeholder={session.amount_gbp?.toFixed(2)}
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs text-stone-400 mb-1">备注（可选）</label>
        <textarea rows={2} className={inputCls + ' resize-none'} placeholder="如：微信支付、现金、已抹零…"
          value={note} onChange={e => setNote(e.target.value)} />
      </div>

      {session.booking_id && (
        <p className="text-xs text-stone-400 mb-3 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          结算后将自动把关联预约标记为「已完成」
        </p>
      )}

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      <button
        onClick={handleSettle}
        disabled={saving}
        className="w-full py-3 rounded-2xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 disabled:opacity-50 transition shadow-sm"
      >
        {saving ? '结算中…' : '✅ 确认结算'}
      </button>
    </div>
  )
}
