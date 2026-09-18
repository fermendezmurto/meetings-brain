import { promises as fs } from 'node:fs'
import type { Transcripcion } from '../types'
import type { Transcriptor } from './index'

/**
 * Transcriptor de prueba: no llama a nadie, inventa una reunion corta de tres
 * voces. Sirve para correr el circuito entero sin una sola credencial.
 */
export const transcriptorMock: Transcriptor = {
  nombre: 'mock',
  async transcribir(rutaAudio, idioma) {
    const { size } = await fs.stat(rutaAudio)
    const guion = [
      [0, 'Buenos dias. Arrancamos con el estado del proyecto.'],
      [1, 'Yo avance con el modelo de precios pero me falta el corte por segmento.'],
      [0, 'Necesito eso cerrado para el lunes, va a la reunion de directorio.'],
      [2, 'Del lado tecnico el riesgo es la integracion; lo reviso esta semana.'],
      [1, 'Lo dejo listo el viernes entonces.'],
      [0, 'Queda asi. La pregunta abierta sigue siendo si el IVA va incluido.'],
    ] as const

    return {
      idioma,
      duracionSeg: Math.max(30, Math.round(size / 4000)),
      turnos: guion.map(([hablante, texto], i) => ({
        hablante,
        desde: i * 12,
        hasta: i * 12 + 11,
        texto,
      })),
    } satisfies Transcripcion
  },
}
