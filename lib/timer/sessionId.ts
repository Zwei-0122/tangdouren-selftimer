import { createAdminClient } from '@/lib/supabase/admin'

export async function generateTimerSessionId(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  const london = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const dateStr = london.replace(/-/g, '')
  const prefix  = `PB-${dateStr}-`

  const { count } = await admin
    .from('timer_sessions')
    .select('*', { count: 'exact', head: true })
    .like('session_id', `${prefix}%`)

  const seq = String((count ?? 0) + 1).padStart(3, '0')
  return `${prefix}${seq}`
}
