import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { config } from '@/lib/config'
import { canjearCodigo, perfil } from '@/lib/google'
import { COOKIE_ESTADO } from '@/lib/cookie'
import { COOKIE, firmar, guardarTokens, nuevoSid } from '@/lib/session'

export async function GET(pedido: NextRequest) {
  const params = pedido.nextUrl.searchParams
  const galletas = await cookies()

  const esperado = galletas.get(COOKIE_ESTADO)?.value
  if (!esperado || params.get('state') !== esperado) {
    return error('La sesion de login vencio. Volve a intentar.')
  }
  galletas.delete(COOKIE_ESTADO)

  const codigo = params.get('code')
  if (!codigo) return error(params.get('error') ?? 'Google no devolvio el codigo')

  const tokens = await canjearCodigo(codigo)
  const quien = await perfil(tokens.access_token)

  // El dominio se verifica contra el perfil, no contra el parametro hd del
  // pedido: hd solo cambia lo que muestra la pantalla de Google.
  if (config.dominioPermitido && quien.dominio !== config.dominioPermitido) {
    return error(`Esta app es solo para cuentas de ${config.dominioPermitido}`)
  }

  const sid = nuevoSid()
  await guardarTokens(sid, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    venceEn: Date.now() + tokens.expires_in * 1000,
  })

  galletas.set(
    COOKIE,
    await firmar({ email: quien.email, nombre: quien.nombre, foto: quien.foto, sid }),
    { httpOnly: true, sameSite: 'lax', path: '/', secure: config.appUrl.startsWith('https') },
  )
  return NextResponse.redirect(new URL('/', config.appUrl))
}

function error(mensaje: string) {
  const url = new URL('/', config.appUrl)
  url.searchParams.set('error', mensaje)
  return NextResponse.redirect(url)
}
