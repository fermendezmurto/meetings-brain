import { config } from '../config'
import type { Transcripcion } from '../types'
import { transcriptorMock } from './mock'
import { transcriptorGemini } from './gemini'
import { transcriptorDeepgram } from './deepgram'
import { transcriptorAssemblyAI } from './assemblyai'

export interface Transcriptor {
  nombre: string
  transcribir(rutaAudio: string, idioma: string): Promise<Transcripcion>
}

export function elegirTranscriptor(): Transcriptor {
  switch (config.transcriptor) {
    case 'gemini':
      return transcriptorGemini
    case 'deepgram':
      return transcriptorDeepgram
    case 'assemblyai':
      return transcriptorAssemblyAI
    case 'mock':
      return transcriptorMock
    default:
      throw new Error(`TRANSCRIBER desconocido: ${config.transcriptor}`)
  }
}

/**
 * Los proveedores devuelven palabras sueltas con numero de hablante. Juntarlas
 * en turnos es lo que hace legible la transcripcion y lo que despues permite
 * ponerle nombre a cada voz.
 */
export function agruparEnTurnos(
  palabras: { texto: string; desde: number; hasta: number; hablante: number }[],
): Transcripcion['turnos'] {
  const turnos: Transcripcion['turnos'] = []
  for (const p of palabras) {
    const ultimo = turnos[turnos.length - 1]
    if (ultimo && ultimo.hablante === p.hablante) {
      ultimo.texto += ` ${p.texto}`
      ultimo.hasta = p.hasta
    } else {
      turnos.push({
        hablante: p.hablante,
        desde: p.desde,
        hasta: p.hasta,
        texto: p.texto,
      })
    }
  }
  return turnos
}
