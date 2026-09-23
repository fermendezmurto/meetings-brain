import { aBase64 } from './base64'

/**
 * Cómo viaja una grabación del teléfono al Asistente. No sabe nada de React ni
 * de Expo: recibe cómo hablar con el Asistente y cómo leer el archivo, y así se
 * prueba en la computadora contra el Asistente simulado
 * (tests/asistente/app.test.ts).
 *
 * El Asistente guarda por dónde va cada grabación. La app siempre le pregunta
 * y sigue desde ahí: si se cortó la señal, si se cerró la app o si una
 * respuesta no llegó, nunca se manda dos veces lo mismo ni se pierde nada.
 */

export type Pedir = (cuerpo: Record<string, unknown>) => Promise<any>
export type LeerParte = (desde: number, largo: number) => Promise<Uint8Array> | Uint8Array

export interface DatosDeGrabacion {
  id: string
  tamanio: number
  tipo: string
  nota?: string
}

export interface OpcionesDeEnvio {
  /** Se llama con los bytes que ya tiene el Asistente. */
  progreso?: (recibidos: number) => void
  /** Cuántos errores seguidos se aguantan antes de rendirse hasta la próxima vez. */
  maxFallas?: number
  esperar?: (ms: number) => Promise<void>
}

/** Un error que no se arregla reintentando: la app lo muestra y deja de insistir. */
export class ErrorDefinitivo extends Error {
  constructor(mensaje: string, readonly desvinculado = false) {
    super(mensaje)
  }
}

const PARTE_POR_DEFECTO = 4 * 1024 * 1024

const esperarDeVerdad = (ms: number) => new Promise<void>((listo) => setTimeout(listo, ms))

export async function enviarGrabacion(
  g: DatosDeGrabacion,
  token: string,
  pedir: Pedir,
  leer: LeerParte,
  opciones: OpcionesDeEnvio = {},
): Promise<void> {
  const esperar = opciones.esperar ?? esperarDeVerdad
  const maxFallas = opciones.maxFallas ?? 6
  let fallas = 0

  const iniciar = () => pedir({ accion: 'iniciar', token, id: g.id, tamanio: g.tamanio, tipo: g.tipo, nota: g.nota ?? '' })

  /** Ante un error pasajero: espera cada vez más y pregunta de nuevo por dónde va. */
  const reintentar = async (motivo: string) => {
    fallas++
    if (fallas > maxFallas) throw new Error(motivo)
    await esperar(Math.min(2000 * 2 ** (fallas - 1), 60000))
  }

  let estado: any = null
  let parte = PARTE_POR_DEFECTO
  while (true) {
    if (!estado) {
      let r: any
      try {
        r = await iniciar()
      } catch (err: any) {
        await reintentar('Sin conexión con el Asistente: ' + (err?.message ?? err))
        continue
      }
      if (!r?.ok) {
        if (r?.desvinculado || r?.definitivo) throw new ErrorDefinitivo(r.error, Boolean(r.desvinculado))
        await reintentar(r?.error ?? 'El Asistente no contestó.')
        continue
      }
      estado = r
      parte = r.parteBytes || parte
    }
    if (estado.terminada) {
      opciones.progreso?.(g.tamanio)
      return
    }

    const desde = Number(estado.recibidos) || 0
    opciones.progreso?.(desde)
    const bytes = await leer(desde, Math.min(parte, g.tamanio - desde))
    let r: any
    try {
      r = await pedir({ accion: 'parte', token, id: g.id, desde, datos: aBase64(bytes) })
    } catch (err: any) {
      // No se sabe si llegó: se vuelve a preguntar por dónde va.
      estado = null
      await reintentar('Se cortó la conexión: ' + (err?.message ?? err))
      continue
    }
    if (!r?.ok) {
      if (r?.desvinculado || r?.definitivo) throw new ErrorDefinitivo(r.error, Boolean(r.desvinculado))
      estado = null
      await reintentar(r?.error ?? 'El Asistente no contestó.')
      continue
    }
    fallas = 0
    estado = r
  }
}

/** Un identificador corto y sin guiones, como los que usa el Asistente. */
export function nuevoId(): string {
  let id = ''
  for (let i = 0; i < 12; i++) id += Math.floor(Math.random() * 16).toString(16)
  return id
}
