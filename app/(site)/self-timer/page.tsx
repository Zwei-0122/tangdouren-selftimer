'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { getSeatOptionsForTable, SELF_SERVICE_TABLE_CODES } from '@/lib/timer/selfServiceCore'

type Phase = 'home' | 'tutorial' | 'form' | 'confirm'

const SESSION_LS_KEY = 'tangdouren_self_timer_session_id'

const tutorialImages = Array.from({ length: 9 }, (_, index) => `/self-timer-tutorial/${index + 1}.jpg`)

const copy = {
  zh: {
    badge: '到店自助计时',
    title: '开始你的拼豆时间',
    subtitle: '扫描二维码后，您可以自己选择座位号并开始个人计时。\n暂停和结束计时请呼唤店员。',
    start: '开始个人计时',
    tutorial: '查看图片教程',
    restore: '恢复我的计时',
    tutorialTitle: '图片教程',
    tutorialBody: '请按顺序查看图片教程。熨烫和需要协助时，请呼唤店员。',
    tableLabel: '桌号',
    seatLabel: '座位号',
    chooseTable: '请选择桌号',
    chooseSeat: '请选择座位号',
    name: '称呼',
    namePlaceholder: '希望我们怎么称呼您',
    continue: '继续',
    confirmTitle: '开始前请确认',
    confirmWarning: '请勿撒豆或混豆，否则将收取 £2/瓶整理费。',
    confirmBack: '返回主页',
    confirmStart: '确认并开始计时',
    starting: '正在开始…',
    contactStaff: '如需暂停或结束计时，请联系店员。',
    guestOnly: '本期为本次体验计时；暂不收集邮箱或累计会员时长。',
  },
  en: {
    badge: 'In-store self timer',
    title: 'Start your bead art time',
    subtitle: 'Scan the QR code, choose your seat number, and start your personal timer. Pause and stop are controlled by staff.',
    start: 'Start Personal Timer',
    tutorial: 'View Tutorial',
    restore: 'Resume My Timer',
    tutorialTitle: 'Tutorial',
    tutorialBody: 'Please follow the tutorial images in order. Ask staff for ironing or whenever you need help.',
    tableLabel: 'Table',
    seatLabel: 'Seat number',
    chooseTable: 'Choose your table',
    chooseSeat: 'Choose your seat',
    name: 'Name',
    namePlaceholder: 'Enter your name',
    continue: 'Continue',
    confirmTitle: 'Please confirm before starting',
    confirmWarning: 'Please do not spill or mix beads, otherwise a £2/bottle sorting fee will be charged.',
    confirmBack: 'Back to home',
    confirmStart: 'Confirm & Start Timer',
    starting: 'Starting…',
    contactStaff: 'Please contact staff if you need to pause or finish.',
    guestOnly: 'This version is for one-off session timing only. Email collection and member history are not enabled yet.',
  },
} as const

function makeIdempotencyKey() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function SelfTimerPage() {
  const router = useRouter()
  const { lang } = useLanguage()
  const c = copy[lang]
  const [phase, setPhase] = useState<Phase>('home')
  const [tableNumber, setTableNumber] = useState('')
  const [seatNumber, setSeatNumber] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [tableCodes, setTableCodes] = useState<string[]>([...SELF_SERVICE_TABLE_CODES])
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tutorialStep, setTutorialStep] = useState(0)
  const idempotencyKey = useMemo(makeIdempotencyKey, [])

  useEffect(() => {
    try { setSavedSessionId(localStorage.getItem(SESSION_LS_KEY)) } catch {}
    void fetch('/api/self-timer/tables', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then((data: { tables?: string[] } | null) => {
        if (data?.tables?.length) setTableCodes(data.tables)
      })
      .catch(() => {})
  }, [])

  function validateForm() {
    if (!tableNumber.trim()) return lang === 'zh' ? '请选择桌号' : 'Please choose your table'
    if (!seatNumber.trim()) return lang === 'zh' ? '请选择座位号' : 'Please choose your seat'
    if (!customerName.trim()) return lang === 'zh' ? '请输入姓名' : 'Please enter your name'
    return ''
  }

  async function startTimer() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/self-timer/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNumber, seatNumber, customerName, confirmNoMixedBeans: true, idempotencyKey }),
      })
      const data = await res.json() as { sessionId?: string; error?: string }
      if (!res.ok || !data.sessionId) { setError(data.error ?? 'Start failed'); return }
      localStorage.setItem(SESSION_LS_KEY, data.sessionId)
      router.push(`/self-timer/session/${data.sessionId}`)
    } finally { setLoading(false) }
  }

  const inputCls = 'w-full rounded-2xl border border-sand-200 bg-white px-4 py-3 text-sm text-charcoal placeholder:text-charcoal-light/50 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20'
  const seatOptions = getSeatOptionsForTable(tableNumber)

  return (
    <div className="min-h-screen bg-gradient-to-br from-cream-100 via-orange-50 to-rose-50 px-4 pb-24 pt-24">
      <div className="mx-auto max-w-md space-y-4">
        <div className="text-center">
          <span className="inline-flex rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-terracotta shadow-sm">{c.badge}</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-charcoal">{c.title}</h1>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-charcoal-light">{c.subtitle}</p>
        </div>

        {phase === 'home' && (
          <div className="card p-5 space-y-3">
            {savedSessionId && <button className="btn-secondary w-full" onClick={() => router.push(`/self-timer/session/${savedSessionId}`)}>{c.restore}</button>}
            <button className="btn-primary w-full" onClick={() => setPhase('form')}>{c.start}</button>
            <button className="btn-secondary w-full" onClick={() => setPhase('tutorial')}>{c.tutorial}</button>
            <p className="text-center text-xs text-stone-400">{c.contactStaff}</p>
          </div>
        )}

        {phase === 'tutorial' && (
          <div className="card p-5 space-y-4">
            <h2 className="font-display text-xl font-semibold text-charcoal">{c.tutorialTitle}</h2>
            <p className="text-sm leading-6 text-charcoal-light">{c.tutorialBody}</p>
            <figure className="overflow-hidden rounded-3xl border border-sand-100 bg-white shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tutorialImages[tutorialStep]}
                alt={lang === 'zh' ? `拼豆图片教程第 ${tutorialStep + 1} 步` : `Bead art tutorial step ${tutorialStep + 1}`}
                className="w-full object-cover"
              />
              <figcaption className="px-4 py-2 text-center text-xs text-stone-400">
                {lang === 'zh' ? `第 ${tutorialStep + 1} 步 / 共 ${tutorialImages.length} 步` : `Step ${tutorialStep + 1} / ${tutorialImages.length}`}
              </figcaption>
            </figure>
            <div className="flex items-center justify-between gap-3">
              <button
                className="btn-secondary flex-1"
                onClick={() => setTutorialStep(step => Math.max(0, step - 1))}
                disabled={tutorialStep === 0}
              >
                {lang === 'zh' ? '上一步' : 'Previous'}
              </button>
              <button
                className="btn-secondary flex-1"
                onClick={() => setTutorialStep(step => Math.min(tutorialImages.length - 1, step + 1))}
                disabled={tutorialStep === tutorialImages.length - 1}
              >
                {lang === 'zh' ? '下一步' : 'Next'}
              </button>
            </div>
            <div className="flex justify-center gap-1.5">
              {tutorialImages.map((src, index) => (
                <button
                  key={src}
                  type="button"
                  aria-label={lang === 'zh' ? `跳到第 ${index + 1} 步` : `Go to step ${index + 1}`}
                  onClick={() => setTutorialStep(index)}
                  className={`h-2 rounded-full transition-all ${index === tutorialStep ? 'w-5 bg-terracotta' : 'w-2 bg-sand-200'}`}
                />
              ))}
            </div>
            <button className="btn-primary w-full" onClick={() => setPhase('form')}>{c.start}</button>
            <button className="btn-ghost w-full" onClick={() => { setTutorialStep(0); setPhase('home') }}>{c.confirmBack}</button>
          </div>
        )}

        {phase === 'form' && (
          <div className="card p-5 space-y-4">
            <p className="rounded-2xl bg-stone-50 px-4 py-3 text-xs leading-5 text-stone-500">{c.guestOnly}</p>
            <label className="block">
              <span className="label">{c.tableLabel}</span>
              <select
                className={inputCls}
                value={tableNumber}
                onChange={e => { setTableNumber(e.target.value); setSeatNumber('') }}
              >
                <option value="">{c.chooseTable}</option>
                {tableCodes.map(code => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">{c.seatLabel}</span>
              <select
                className={inputCls}
                value={seatNumber}
                onChange={e => setSeatNumber(e.target.value)}
                disabled={!tableNumber}
              >
                <option value="">{c.chooseSeat}</option>
                {seatOptions.map(code => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">{c.name}</span>
              <input className={inputCls} value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder={c.namePlaceholder} />
            </label>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button className="btn-primary w-full" onClick={() => { const msg = validateForm(); if (msg) setError(msg); else setPhase('confirm') }}>{c.continue}</button>
          </div>
        )}

        {phase === 'confirm' && (
          <div className="card p-5 space-y-4">
            <h2 className="font-display text-xl font-semibold text-charcoal">{c.confirmTitle}</h2>
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">{c.confirmWarning}</div>
            <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-charcoal-light">
              <p>{c.tableLabel}: <strong className="text-charcoal">{tableNumber}</strong></p>
              <p>{c.seatLabel}: <strong className="text-charcoal">{seatNumber}</strong></p>
              <p>{c.name}: <strong className="text-charcoal">{customerName}</strong></p>
            </div>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button className="btn-primary w-full" onClick={startTimer} disabled={loading}>{loading ? c.starting : c.confirmStart}</button>
            <button className="btn-ghost w-full" onClick={() => setPhase('home')}>{c.confirmBack}</button>
          </div>
        )}
      </div>
    </div>
  )
}
