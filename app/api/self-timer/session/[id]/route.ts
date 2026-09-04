import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSelfTimerSession } from '@/lib/timer/selfService'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getSelfTimerSession(createAdminClient(), id)

  if (!session) return NextResponse.json({ error: '计时订单不存在' }, { status: 404 })
  return NextResponse.json({ session }, { headers: { 'Cache-Control': 'no-store' } })
}
