import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listActiveTableCodes } from '@/lib/timer/selfService'

export async function GET() {
  try {
    const tables = await listActiveTableCodes(createAdminClient())
    return NextResponse.json({ tables }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: '桌号列表加载失败' }, { status: 500 })
  }
}
