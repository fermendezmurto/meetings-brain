import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { enModoPrueba } from '@/lib/config'
import { urlDeLogin } from '@/lib/google'
import { COOKIE_ESTADO } from '@/lib/cookie'
import { COOKIE, firmar, nuevoSid } from '@/lib/session'

export async function GET() {
  const galletas = await cookies()

  // Sin credenciales de Google se entra como usuario de prueba, para poder
  // recorrer la app entera sin configurar nada.
  if (enModoPrueba()) {
    galletas.set(
      COOKIE,
      await firmar({
        email: 'prueba@local',
        nombre: 'Usuario de prueba',
        foto: '',
        sid: nuevoSid(),
      }),
      { httpOnly: true, sameSite: 'lax', path: '/' },
    )
    return NextResponse.redirect(new URL('/', process.env.APP_URL ?? 'http://localhost:3000'))
  }

  // El state protege contra CSRF en el callback: tiene que volver igual.
  const estado = randomUUID()
  galletas.set(COOKIE_ESTADO, estado, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return NextResponse.redirect(urlDeLogin(estado))
}
