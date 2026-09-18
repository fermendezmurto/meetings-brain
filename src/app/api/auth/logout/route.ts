import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { COOKIE, borrarTokens, sesionActual } from '@/lib/session'

export async function POST() {
  const s = await sesionActual()
  if (s) await borrarTokens(s.sid)
  ;(await cookies()).delete(COOKIE)
  return NextResponse.redirect(new URL('/', config.appUrl), { status: 303 })
}
