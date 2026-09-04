'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { calcBill, calcBillingMinutes, formatChineseDuration, formatHMS } from '@/lib/timer/pricing'

interface SessionView {
  session_id: string
  customer_name: string
  status: 'idle' | 'running' | 'paused' | 'completed'
  started_at: string | null
  paused_at: string | null
  total_paused_ms: number
  stopped_at: string | null
  elapsed_minutes: number | null
  billing_minutes: number | null
  amount_gbp: number | null
  amount_cny: number | null
  exchange_rate: number | null
  bill_breakdown: { label: string; amount: number }[] | null
  table_number: string | null
}

const SESSION_LS_KEY = 'tangdouren_self_timer_session_id'

function calcElapsedSeconds(session: SessionView): number {
  if (session.status === 'idle') return 0
  if (session.status === 'completed' && session.elapsed_minutes !== null) return session.elapsed_minutes * 60
  if (!session.started_at) return 0
  const started = new Date(session.started_at).getTime()
  const totalPaused = session.total_paused_ms ?? 0
  if (session.status === 'paused' && session.paused_at) {
    return Math.max(0, (new Date(session.paused_at).getTime() - started - totalPaused) / 1000)
  }
  return Math.max(0, (Date.now() - started - totalPaused) / 1000)
}

const copy = {
  zh: {
    loading: '加载中…',
    missing: '找不到计时订单',
    back: '返回自助首页',
    running: '拼豆进行中 ✨',
    paused: '计时已由店员暂停',
    completed: '拼豆已完成 🎉',
    idle: '等待开始',
    elapsed: '本次时长',
    finalElapsed: '最终有效时长',
    estimated: '预估费用（参考）',
    finalBill: '最终账单',
    billing: '计费',
    total: '合计',
    staff: '如需暂停或结束计时，请联系店员。',
    auto: '每 5 秒自动更新',
  },
  en: {
    loading: 'Loading…',
    missing: 'Timer not found',
    back: 'Back to self-service home',
    running: 'Bead art in progress ✨',
    paused: 'Timer paused by staff',
    completed: 'Session completed 🎉',
    idle: 'Waiting to start',
    elapsed: 'Current time',
    finalElapsed: 'Final effective time',
    estimated: 'Estimated bill',
    finalBill: 'Final bill',
    billing: 'billing',
    total: 'Total',
    staff: 'Please contact staff if you need to pause or finish.',
    auto: 'Auto refreshes every 5 seconds',
  },
} as const

export default function SelfTimerSessionPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { lang } = useLanguage()
  const c = copy[lang]
  const [session, setSession] = useState<SessionView | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/self-timer/session/${id}`, { cache: 'no-store' })
      if (!res.ok) { setError(c.missing); setLoading(false); return }
      const data = await res.json() as { session: SessionView }
      setSession(data.session)
      setElapsed(calcElapsedSeconds(data.session))
      setLoading(false)
      try {
        if (data.session.status === 'completed') localStorage.removeItem(SESSION_LS_KEY)
        else localStorage.setItem(SESSION_LS_KEY, data.session.session_id)
      } catch {}
    } catch {
      setError(lang === 'zh' ? '网络错误，请刷新页面' : 'Network error. Please refresh.')
      setLoading(false)
    }
  }, [c.missing, id, lang])

  useEffect(() => {
    fetchSession()
    pollRef.current = setInterval(fetchSession, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchSession])

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current)
    if (session?.status === 'running') tickRef.current = setInterval(() => setElapsed(calcElapsedSeconds(session)), 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [session])

  if (loading) return <div className="min-h-screen bg-cream-100 pt-28 text-center text-stone-400">{c.loading}</div>
  if (error || !session) {
    return (
      <div className="min-h-screen bg-cream-100 px-4 pt-28 text-center">
        <p className="text-xl font-semibold text-charcoal">{error || c.missing}</p>
        <button className="btn-secondary mt-4" onClick={() => router.push('/self-timer')}>{c.back}</button>
      </div>
    )
  }

  const isCompleted = session.status === 'completed'
  const isPaused = session.status === 'paused'
  const liveBillingMin = calcBillingMinutes(Math.floor(elapsed / 60))
  const liveBill = calcBill(liveBillingMin)
  const lines = isCompleted ? (session.bill_breakdown ?? []) : liveBill.lines
  const totalGbp = isCompleted ? (session.amount_gbp ?? 0) : liveBill.totalGbp
  const billingMinutes = isCompleted ? (session.billing_minutes ?? 0) : liveBillingMin
  const statusText = isCompleted ? c.completed : isPaused ? c.paused : session.status === 'idle' ? c.idle : c.running

  return (
    <div className="min-h-screen bg-gradient-to-br from-cream-100 via-orange-50 to-rose-50 px-4 pb-24 pt-24">
      <div className="mx-auto max-w-md space-y-4">
        <div className="card overflow-hidden">
          <div className={`px-6 py-4 text-center ${isCompleted ? 'bg-emerald-500' : isPaused ? 'bg-amber-500' : 'bg-terracotta'}`}>
            <p className="text-xs text-white/80">{session.customer_name} · {session.table_number ?? '--'} · {session.session_id}</p>
            <p className="mt-1 text-sm font-semibold text-white">{statusText}</p>
          </div>
          <div className="px-6 py-7 text-center">
            <p className="text-xs text-stone-400">{isCompleted ? c.finalElapsed : c.elapsed}</p>
            <p className="mt-1 font-mono text-5xl font-bold tracking-wider text-charcoal tabular-nums">{formatHMS(elapsed)}</p>
            <p className="mt-1 text-sm text-charcoal-light">{formatChineseDuration(elapsed)}</p>
          </div>
        </div>

        <div className="card px-5 py-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">{isCompleted ? c.finalBill : c.estimated}</p>
          {lines.map((line, index) => (
            <div key={index} className="flex justify-between border-b border-stone-100 py-1.5 text-sm last:border-0">
              <span className="text-stone-600">{line.label}</span>
              <span className="font-medium text-charcoal">£{line.amount.toFixed(2)}</span>
            </div>
          ))}
          <div className="mt-2 flex items-baseline justify-between pt-2">
            <span className="text-sm font-semibold text-charcoal">{c.total} ({c.billing} {billingMinutes} min)</span>
            <span className="text-2xl font-bold text-terracotta">£{totalGbp.toFixed(2)}</span>
          </div>
          {isCompleted && session.amount_cny && session.exchange_rate && (
            <p className="mt-1 text-right text-xs text-stone-400">≈ ¥{session.amount_cny.toFixed(2)} ({session.exchange_rate.toFixed(4)})</p>
          )}
        </div>

        {!isCompleted && <p className="rounded-2xl bg-white/70 px-4 py-3 text-center text-sm text-charcoal-light shadow-sm">{c.staff}</p>}
        <p className="text-center text-xs text-stone-400">{c.auto} · {session.session_id}</p>
      </div>
    </div>
  )
}
