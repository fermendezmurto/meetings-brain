import { promises as fs } from 'node:fs'
import { config } from './config'

const ARCHIVOS = 'https://www.googleapis.com/drive/v3/files'
const SUBIDA = 'https://www.googleapis.com/upload/drive/v3/files'
const CARPETA = 'application/vnd.google-apps.folder'

/**
 * Nota sobre permisos: la app pide el scope drive.file, que la limita a los
 * archivos que ella misma crea. Alcanza para todo el arbol /Reuniones porque lo
 * crea ella. Si DRIVE_ROOT_FOLDER_ID apunta a una carpeta preexistente de una
 * unidad compartida, Google puede rechazar la escritura ahi: en ese caso hay que
 * dejar que la app cree la carpeta raiz una vez y usar ese id.
 */
async function api<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  })
  if (!r.ok) throw new Error(`Drive fallo: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

/** Devuelve la carpeta con ese nombre dentro del padre, creandola si no esta. */
export async function asegurarCarpeta(
  token: string,
  nombre: string,
  padreId: string,
): Promise<string> {
  const q = [
    `name = '${nombre.replace(/'/g, "\\'")}'`,
    `mimeType = '${CARPETA}'`,
    `'${padreId}' in parents`,
    'trashed = false',
  ].join(' and ')

  const buscados = await api<{ files: { id: string }[] }>(
    token,
    `${ARCHIVOS}?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  )
  const existente = buscados.files?.[0]?.id
  if (existente) return existente

  const creada = await api<{ id: string }>(
    token,
    `${ARCHIVOS}?fields=id&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: nombre, mimeType: CARPETA, parents: [padreId] }),
    },
  )
  return creada.id
}

/** Crea /Reuniones/AAAA/MM/<carpeta de la reunion> y devuelve el id del final. */
export async function asegurarRuta(
  token: string,
  tramos: string[],
  raizId?: string,
): Promise<string> {
  let padre = raizId || config.driveRaizId || 'root'
  for (const tramo of tramos) {
    padre = await asegurarCarpeta(token, tramo, padre)
  }
  return padre
}

interface Subida {
  nombre: string
  mimeType: string
  padreId: string
  /** Para convertir a documento de Google: 'application/vnd.google-apps.document'. */
  convertirA?: string
}

/**
 * Subida en dos pasos (resumable). Para el audio de una reunion larga es la
 * unica forma razonable: un multipart de cien megas se cae y hay que empezar
 * de cero.
 */
export async function subirArchivo(
  token: string,
  ruta: string,
  s: Subida,
): Promise<string> {
  const datos = await fs.readFile(ruta)
  return subirContenido(token, datos, s)
}

export async function subirContenido(
  token: string,
  datos: Buffer | string,
  s: Subida,
): Promise<string> {
  const cuerpo = typeof datos === 'string' ? Buffer.from(datos, 'utf8') : datos

  const metadatos: Record<string, unknown> = { name: s.nombre, parents: [s.padreId] }
  if (s.convertirA) metadatos.mimeType = s.convertirA

  const inicio = await fetch(
    `${SUBIDA}?uploadType=resumable&fields=id&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'X-Upload-Content-Type': s.mimeType,
        'X-Upload-Content-Length': String(cuerpo.byteLength),
      },
      body: JSON.stringify(metadatos),
    },
  )
  if (!inicio.ok) throw new Error(`Drive rechazo la subida: ${await inicio.text()}`)

  const destino = inicio.headers.get('location')
  if (!destino) throw new Error('Drive no devolvio URL de subida')

  const r = await fetch(destino, {
    method: 'PUT',
    headers: { 'content-type': s.mimeType, 'content-length': String(cuerpo.byteLength) },
    body: new Uint8Array(cuerpo),
  })
  if (!r.ok) throw new Error(`Drive fallo al subir: ${r.status} ${await r.text()}`)
  const { id } = (await r.json()) as { id: string }
  return id
}

/** Da acceso a alguien sobre un archivo o carpeta, sin mandarle correo. */
export async function compartir(
  token: string,
  archivoId: string,
  email: string,
  rol: 'reader' | 'writer' = 'reader',
): Promise<void> {
  await api(
    token,
    `${ARCHIVOS}/${archivoId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: rol, emailAddress: email }),
    },
  )
}
