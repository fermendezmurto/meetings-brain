import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { config } from './config'
import { COOKIE } from './cookie'

export { COOKIE }

export interface Sesion {
  email: string
  nombre: string
  foto: string
  sid: string
}

interface Tokens {
  accessToken: string
  refreshToken: string
  venceEn: number
}

const dirSesiones = path.join(process.cwd(), '.data', 'sesiones')

function clave() {
  return new TextEncoder().encode(config.sessionSecret)
}

/**
 * Los tokens de Google se quedan en el servidor: la cookie solo lleva quien es
 * y el id de sesion. Asi un XSS no se lleva el acceso al Drive de nadie.
 */
export async function guardarTokens(sid: string, t: Tokens): Promise<void> {
  await fs.mkdir(dirSesiones, { recursive: true })
  await fs.writeFile(path.join(dirSesiones, `${sid}.json`), JSON.stringify(t), 'utf8')
}

export async function leerTokens(sid: string): Promise<Tokens | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(dirSesiones, `${sid}.json`), 'utf8'),
    ) as Tokens
  } catch {
    return null
  }
}

export async function borrarTokens(sid: string): Promise<void> {
  await fs.rm(path.join(dirSesiones, `${sid}.json`), { force: true })
}

export function nuevoSid(): string {
  return randomUUID()
}

export async function firmar(s: Sesion): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(clave())
}

export async function sesionActual(): Promise<Sesion | null> {
  const bruta = (await cookies()).get(COOKIE)?.value
  if (!bruta) return null
  try {
    const { payload } = await jwtVerify(bruta, clave())
    return {
      email: String(payload.email),
      nombre: String(payload.nombre),
      foto: String(payload.foto ?? ''),
      sid: String(payload.sid),
    }
  } catch {
    return null
  }
}

/** Para las rutas de API: corta con 401 si no hay sesion. */
export async function exigirSesion(): Promise<Sesion> {
  const s = await sesionActual()
  if (!s) throw new RespuestaError(401, 'Hay que iniciar sesion')
  return s
}

export class RespuestaError extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje)
  }
}
