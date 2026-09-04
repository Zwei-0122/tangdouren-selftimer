import { createAdminClient } from '@/lib/supabase/admin'
import { generateTimerSessionId } from '@/lib/timer/sessionId'
import { normalizeSeatCode, normalizeTableCode, SELF_SERVICE_TABLE_CODES } from '@/lib/timer/selfServiceCore'

type AdminClient = ReturnType<typeof createAdminClient>

export interface SelfTimerSessionView {
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
  created_via: string | null
}

export async function listActiveTableCodes(admin: AdminClient): Promise<string[]> {
  const { data, error } = await admin
    .from('tables')
    .select('table_code')
    .eq('is_active', true)
    .order('table_code', { ascending: true })

  if (error) throw new Error('TABLE_LIST_FAILED')
  const active = new Set((data ?? []).map((row: { table_code: string }) => row.table_code))
  return SELF_SERVICE_TABLE_CODES.filter(code => active.has(code))
}

export async function resolveActiveTableCode(admin: AdminClient, rawTableCode: string): Promise<string | null> {
  const tableCode = normalizeTableCode(rawTableCode)
  if (!tableCode) return null

  const { data, error } = await admin
    .from('tables')
    .select('table_code')
    .eq('table_code', tableCode)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw new Error('TABLE_LOOKUP_FAILED')
  return data?.table_code ?? null
}

export async function resolveActiveSeatCode(admin: AdminClient, rawTableCode: string, rawSeatCode: string): Promise<string | null> {
  const tableCode = await resolveActiveTableCode(admin, rawTableCode)
  if (!tableCode) return null
  return normalizeSeatCode(tableCode, rawSeatCode)
}

export async function resolveActiveSeatCodeFromValue(admin: AdminClient, rawSeatCode: string): Promise<string | null> {
  const normalized = normalizeTableCode(rawSeatCode)
  if (!normalized) return null

  const tableCode = normalized.match(/^[SDF]\d+/)?.[0]
  if (!tableCode) return null
  return resolveActiveSeatCode(admin, tableCode, normalized)
}

export interface StartSelfTimerInput {
  tableNumber: string
  seatNumber: string
  customerName?: string
  confirmNoMixedBeans: boolean
  idempotencyKey?: string
}

export async function startSelfTimer(admin: AdminClient, input: StartSelfTimerInput) {
  if (!input.confirmNoMixedBeans) throw new Error('CONFIRMATION_REQUIRED')

  const seatNumber = await resolveActiveSeatCode(admin, input.tableNumber, input.seatNumber)
  if (!seatNumber) throw new Error('INVALID_SEAT')

  const customerName = input.customerName?.trim() ?? ''
  if (!customerName || customerName.length > 50) throw new Error('INVALID_NAME')

  if (input.idempotencyKey) {
    const { data: existingByKey, error: keyError } = await admin
      .from('timer_sessions')
      .select('session_id')
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle()
    if (keyError) throw new Error('IDEMPOTENCY_LOOKUP_FAILED')
    if (existingByKey?.session_id) return { sessionId: existingByKey.session_id as string, restored: true }
  }

  const sessionId = await generateTimerSessionId(admin)
  const { data, error } = await admin
    .from('timer_sessions')
    .insert({
      session_id: sessionId,
      booking_id: null,
      customer_name: customerName,
      table_number: seatNumber,
      status: 'running',
      started_at: new Date().toISOString(),
      created_via: 'self_service',
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select('session_id')
    .single()

  if (error) throw new Error('SESSION_CREATE_FAILED')
  return { sessionId: data.session_id as string, restored: false }
}

export async function getSelfTimerSession(admin: AdminClient, sessionId: string): Promise<SelfTimerSessionView | null> {
  const { data, error } = await admin
    .from('timer_sessions')
    .select('session_id, customer_name, status, started_at, paused_at, total_paused_ms, stopped_at, elapsed_minutes, billing_minutes, amount_gbp, amount_cny, exchange_rate, bill_breakdown, table_number, created_via')
    .eq('session_id', sessionId)
    .single()

  if (error || !data) return null

  return {
    session_id: data.session_id,
    customer_name: data.customer_name,
    status: data.status,
    started_at: data.started_at,
    paused_at: data.paused_at,
    total_paused_ms: data.total_paused_ms ?? 0,
    stopped_at: data.stopped_at,
    elapsed_minutes: data.elapsed_minutes,
    billing_minutes: data.billing_minutes,
    amount_gbp: data.amount_gbp,
    amount_cny: data.amount_cny,
    exchange_rate: data.exchange_rate,
    bill_breakdown: data.bill_breakdown,
    table_number: data.table_number,
    created_via: data.created_via,
  }
}
