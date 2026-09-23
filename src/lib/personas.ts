import { promises as fs } from 'node:fs'
import { dirDatos } from './datos'

export interface Persona {
  nombre: string
  email: string | null
  rol: string | null
  /** Ultima vez que se la vio: ordena la lista por quien participa mas seguido. */
  vistaEn: string
}

const archivo = () => dirDatos('personas.json')

/**
 * La gente de la empresa. No se carga a mano: se va armando sola con quien
 * entra a la app y con cada nombre que alguien confirma al corregir una voz.
 *
 * Es compartida por todos a proposito. La nomina es la misma para el equipo, y
 * que cada uno tenga que escribir los mismos nombres seria trabajo repetido.
 */
export async function listarPersonas(): Promise<Persona[]> {
  try {
    const crudo = await fs.readFile(archivo(), 'utf8')
    return (JSON.parse(crudo) as Persona[]).sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es'),
    )
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}

/**
 * Compara nombres como los compararia una persona: sin acentos, sin importar
 * mayusculas ni espacios de mas. "Fernando Méndez" y "fernando mendez" son el
 * mismo, y no tiene que aparecer dos veces en la lista.
 */
export function normalizar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Suma a alguien, o refresca lo que ya se sabia de esa persona. Los datos
 * nuevos no pisan a los viejos con vacio: si ya teniamos el correo y esta vez
 * no viene, se conserva.
 */
export async function agregarPersona(
  nombre: string,
  extra: { email?: string | null; rol?: string | null } = {},
): Promise<Persona[]> {
  const limpio = nombre.replace(/\s+/g, ' ').trim()
  if (!limpio) return listarPersonas()

  const actuales = await listarPersonas()
  const clave = normalizar(limpio)
  const previa = actuales.find((p) => normalizar(p.nombre) === clave)

  const persona: Persona = {
    nombre: previa?.nombre ?? limpio,
    email: extra.email ?? previa?.email ?? null,
    rol: extra.rol ?? previa?.rol ?? null,
    vistaEn: new Date().toISOString(),
  }

  const nuevas = [...actuales.filter((p) => normalizar(p.nombre) !== clave), persona]
  await guardar(nuevas)
  return nuevas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

async function guardar(personas: Persona[]): Promise<void> {
  await fs.mkdir(dirDatos(), { recursive: true })
  const tmp = `${archivo()}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(personas, null, 2), 'utf8')
  await fs.rename(tmp, archivo())
}
