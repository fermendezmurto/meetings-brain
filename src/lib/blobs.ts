import { promises as fs, createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

/**
 * Los trozos de audio se guardan de a uno, numerados. Se arman recien al cerrar.
 *
 * Es a proposito: si el telefono pierde la red y reintenta, el mismo trozo se
 * reescribe encima sin duplicar nada, y si la reunion se corta a la mitad queda
 * igual todo lo que llego hasta ahi.
 *
 * Ojo con el formato: MediaRecorder manda la cabecera webm solo en el primer
 * trozo. Concatenar en orden da un archivo que los transcriptores leen bien,
 * pero sin duracion en los metadatos, asi que la duracion la lleva el cliente.
 */
const raiz = path.join(process.cwd(), '.data', 'audio')

function dir(id: string) {
  return path.join(raiz, id)
}

export function nombreTrozo(indice: number) {
  return `${String(indice).padStart(6, '0')}.part`
}

export async function guardarTrozo(
  id: string,
  indice: number,
  datos: Buffer,
): Promise<void> {
  await fs.mkdir(dir(id), { recursive: true })
  const destino = path.join(dir(id), nombreTrozo(indice))
  const tmp = `${destino}.tmp`
  await fs.writeFile(tmp, datos)
  await fs.rename(tmp, destino)
}

/** Indices de los trozos que efectivamente llegaron, en orden. */
export async function trozosRecibidos(id: string): Promise<number[]> {
  try {
    const nombres = await fs.readdir(dir(id))
    return nombres
      .filter((n) => n.endsWith('.part'))
      .map((n) => Number.parseInt(n.slice(0, -5), 10))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}

/** Une los trozos en un solo archivo y devuelve su ruta. */
export async function armarAudio(id: string, extension = 'webm'): Promise<string> {
  const indices = await trozosRecibidos(id)
  if (indices.length === 0) throw new Error(`La grabacion ${id} no tiene audio`)

  const destino = path.join(dir(id), `completo.${extension}`)
  const salida = createWriteStream(destino)
  try {
    for (const i of indices) {
      await pipeline(createReadStream(path.join(dir(id), nombreTrozo(i))), salida, {
        end: false,
      })
    }
  } finally {
    salida.end()
  }
  await new Promise<void>((ok, fallo) => {
    salida.on('finish', ok)
    salida.on('error', fallo)
  })
  return destino
}

/** Borra el audio crudo y deja la ficha. Se usa al vencer la retencion. */
export async function borrarAudio(id: string): Promise<void> {
  await fs.rm(dir(id), { recursive: true, force: true })
}
