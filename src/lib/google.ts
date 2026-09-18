import { config } from './config'
import { guardarTokens, leerTokens } from './session'

/**
 * Solo pedimos drive.file: la app ve unicamente los archivos que ella misma
 * crea, no todo el Drive de la persona. Es el permiso mas chico que sirve y el
 * que menos friccion trae en la revision de Google.
 */
export const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

export function urlDeLogin(estado: string): string {
  const p = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.appUrl}/api/auth/callback`,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: estado,
    include_granted_scopes: 'true',
  })
  // hd le pide a Google que muestre solo cuentas del dominio. No alcanza como
  // control: el dominio se verifica de nuevo contra el perfil al volver.
  if (config.dominioPermitido) p.set('hd', config.dominioPermitido)
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`
}

interface RespuestaToken {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token: string
}

export async function canjearCodigo(codigo: string): Promise<RespuestaToken> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: codigo,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: `${config.appUrl}/api/auth/callback`,
      grant_type: 'authorization_code',
    }),
  })
  if (!r.ok) throw new Error(`Google rechazo el codigo: ${await r.text()}`)
  return (await r.json()) as RespuestaToken
}

export interface PerfilGoogle {
  email: string
  nombre: string
  foto: string
  dominio: string
}

export async function perfil(accessToken: string): Promise<PerfilGoogle> {
  const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) throw new Error(`No se pudo leer el perfil: ${await r.text()}`)
  const p = (await r.json()) as {
    email: string
    name?: string
    picture?: string
    hd?: string
  }
  return {
    email: p.email,
    nombre: p.name ?? p.email,
    foto: p.picture ?? '',
    // hd solo viene en cuentas de Workspace; para gmail.com se deduce del correo.
    dominio: p.hd ?? p.email.split('@')[1] ?? '',
  }
}

/** Token vivo para llamar a Drive. Lo renueva solo si esta por vencer. */
export async function tokenVigente(sid: string): Promise<string> {
  const t = await leerTokens(sid)
  if (!t) throw new Error('La sesion no tiene tokens de Google')
  if (t.venceEn > Date.now() + 60_000) return t.accessToken

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: t.refreshToken,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) throw new Error(`No se pudo renovar el token: ${await r.text()}`)
  const nuevo = (await r.json()) as { access_token: string; expires_in: number }
  await guardarTokens(sid, {
    accessToken: nuevo.access_token,
    refreshToken: t.refreshToken,
    venceEn: Date.now() + nuevo.expires_in * 1000,
  })
  return nuevo.access_token
}
