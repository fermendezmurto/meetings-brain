import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Grabacion } from './types'

/**
 * Almacen de fichas en disco: un JSON por grabacion. Alcanza para un equipo chico
 * y para las pruebas; cuando haga falta concurrencia real esto pasa a Postgres
 * sin tocar a quien lo llama.
 */
const raiz = path.join(process.cwd(), '.data')
const fichas = path.join(raiz, 'grabaciones')

async function asegurarDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

function archivo(id: string) {
  return path.join(fichas, `${id}.json`)
}

export async function guardar(g: Grabacion): Promise<void> {
  await asegurarDir(fichas)
  // Escritura atomica: si el proceso muere a mitad, la ficha anterior sigue entera.
  const tmp = `${archivo(g.id)}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(g, null, 2), 'utf8')
  await fs.rename(tmp, archivo(g.id))
}

export async function leer(id: string): Promise<Grabacion | null> {
  try {
    return JSON.parse(await fs.readFile(archivo(id), 'utf8')) as Grabacion
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

/** Aplica un cambio sobre la ficha ya guardada. Devuelve null si no existe. */
export async function actualizar(
  id: string,
  cambio: (g: Grabacion) => Grabacion,
): Promise<Grabacion | null> {
  const actual = await leer(id)
  if (!actual) return null
  const nueva = cambio(actual)
  await guardar(nueva)
  return nueva
}

/** Las grabaciones de una persona, de la mas nueva a la mas vieja. */
export async function listar(usuario: string): Promise<Grabacion[]> {
  await asegurarDir(fichas)
  const nombres = await fs.readdir(fichas)
  const todas = await Promise.all(
    nombres.filter((n) => n.endsWith('.json')).map((n) => leer(n.slice(0, -5))),
  )
  return todas
    .filter((g): g is Grabacion => g !== null && g.usuario === usuario)
    .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn))
}
