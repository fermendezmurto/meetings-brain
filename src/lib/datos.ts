import path from 'node:path'

/**
 * Donde viven el audio, las fichas y las sesiones.
 *
 * Es configurable porque en un servidor de verdad esto apunta a un disco
 * montado aparte: si queda dentro del contenedor, cada despliegue se lleva
 * puestas las grabaciones.
 */
export function dirDatos(...tramos: string[]): string {
  const raiz = process.env.DATA_DIR?.trim() || path.join(process.cwd(), '.data')
  return path.join(raiz, ...tramos)
}
