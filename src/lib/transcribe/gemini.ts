import path from 'node:path'
import { pedirJson, subirArchivo } from '../gemini'
import type { Transcripcion } from '../types'
import type { Transcriptor } from './index'

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    idioma: { type: 'STRING' },
    turnos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          hablante: { type: 'INTEGER' },
          desde: { type: 'NUMBER' },
          hasta: { type: 'NUMBER' },
          texto: { type: 'STRING' },
        },
        required: ['hablante', 'desde', 'hasta', 'texto'],
      },
    },
  },
  required: ['idioma', 'turnos'],
}

const INSTRUCCION = `Transcribi esta reunion de trabajo en espaniol de Paraguay.

Reglas:
- Separa el audio en turnos de habla. Cada vez que cambia la voz, empieza un turno nuevo.
- Numera las voces desde 0 en el orden en que aparecen. Usa siempre el mismo numero para la misma voz durante toda la reunion.
- "desde" y "hasta" van en segundos desde el inicio del audio.
- Transcribi literal lo que se dice, con puntuacion. No resumas, no corrijas la gramatica de quien habla y no agregues nada que no se haya dicho.
- Manten los nombres propios, montos, fechas y nombres de empresa tal como suenan.
- Si un tramo es inaudible, escribi [inaudible] en lugar de inventar.`

/**
 * Gemini escucha el audio directo: transcribe y separa las voces en una sola
 * llamada, sin transcriptor aparte. Es el camino mas barato con diferencia, y
 * el unico con nivel gratuito real.
 *
 * A cambio, la separacion de voces es menos firme que la de un diarizador
 * dedicado cuando hay muchas personas sobre un solo microfono. Por eso los
 * nombres se confirman despues a mano y no se dan por buenos solos.
 */
export const transcriptorGemini: Transcriptor = {
  nombre: 'gemini',
  async transcribir(rutaAudio, idioma) {
    const uri = await subirArchivo(rutaAudio, 'audio/webm', path.basename(rutaAudio))

    const salida = await pedirJson<Transcripcion>(
      [
        { file_data: { mime_type: 'audio/webm', file_uri: uri } },
        { text: INSTRUCCION },
      ],
      ESQUEMA,
    )

    const turnos = salida.turnos ?? []
    return {
      idioma: salida.idioma || idioma,
      turnos,
      duracionSeg: Math.round(turnos[turnos.length - 1]?.hasta ?? 0),
    }
  },
}
