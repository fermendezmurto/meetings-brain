import { config } from '../config'
import type { Minuta, Transcripcion } from '../types'
import { resumidorMock } from './mock'
import { resumidorGemini } from './gemini'

export interface Contexto {
  titulo: string
  fecha: string
  /** Nombres que ya se conocen: invitados, quien graba, confirmaciones previas. */
  participantesPrevios: string[]
}

export interface Resumidor {
  nombre: string
  resumir(t: Transcripcion, ctx: Contexto): Promise<Minuta>
}

export function elegirResumidor(): Resumidor {
  switch (config.resumidor) {
    case 'gemini':
      return resumidorGemini
    case 'mock':
      return resumidorMock
    default:
      throw new Error(`SUMMARIZER desconocido: ${config.resumidor}`)
  }
}
