import { Directory, File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'

/**
 * Lo que la app recuerda entre una vez y otra: con quién está vinculada y las
 * grabaciones que todavía no terminaron de llegar al Asistente.
 *
 * Las grabaciones viven en la carpeta de documentos de la app, que el sistema
 * no borra solo (la de caché sí puede). Se borran cuando el Asistente ya las
 * tiene guardadas en Drive.
 */

export interface Vinculo {
  url: string
  token: string
  nombre: string
  email: string
}

export type EstadoLocal = 'pendiente' | 'subiendo' | 'enviada' | 'fallo'

export interface Grabacion {
  id: string
  /** Cuándo empezó, en milisegundos. */
  creada: number
  duracionMs: number
  tamanio: number
  tipo: string
  nota: string
  archivo: string
  estado: EstadoLocal
  recibidos: number
  error?: string
  /** El error no se arregla reintentando: se espera a que la persona lo pida. */
  definitivo?: boolean
  /** Lo que dice el Asistente una vez enviada. */
  estadoAsistente?: string
  titulo?: string
  minuta?: string
}

const CLAVE_VINCULO = 'vinculo'

export async function leerVinculo(): Promise<Vinculo | null> {
  const guardado = await SecureStore.getItemAsync(CLAVE_VINCULO)
  return guardado ? (JSON.parse(guardado) as Vinculo) : null
}

export async function guardarVinculo(v: Vinculo | null) {
  if (v) await SecureStore.setItemAsync(CLAVE_VINCULO, JSON.stringify(v))
  else await SecureStore.deleteItemAsync(CLAVE_VINCULO)
}

function carpeta(): Directory {
  const d = new Directory(Paths.document, 'grabaciones')
  if (!d.exists) d.create({ intermediates: true })
  return d
}

function indice(): File {
  return new File(Paths.document, 'grabaciones.json')
}

export function leerGrabaciones(): Grabacion[] {
  const f = indice()
  if (!f.exists) return []
  try {
    return JSON.parse(f.textSync()) as Grabacion[]
  } catch {
    return []
  }
}

export function guardarGrabaciones(lista: Grabacion[]) {
  // Las últimas 50 alcanzan para ver en qué quedó cada una.
  indice().write(JSON.stringify(lista.slice(0, 50)))
}

/** Pasa el audio recién grabado a la carpeta de la app, con el nombre de la grabación. */
export async function guardarAudio(uriGrabado: string, id: string): Promise<{ archivo: string; tamanio: number }> {
  const audio = new File(uriGrabado)
  // Mover actualiza la dirección del mismo objeto.
  await audio.move(new File(carpeta(), id + '.m4a'))
  return { archivo: audio.uri, tamanio: audio.size ?? 0 }
}

export function borrarAudio(archivo: string) {
  const f = new File(archivo)
  if (f.exists) f.delete()
}

/** Lee un pedazo del audio sin cargarlo entero en memoria. */
export function leerPedazo(archivo: string, desde: number, largo: number): Uint8Array {
  const manija = new File(archivo).open()
  try {
    manija.offset = desde
    return manija.readBytes(largo)
  } finally {
    manija.close()
  }
}
