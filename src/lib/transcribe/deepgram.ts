import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { config } from '../config'
import type { Transcripcion } from '../types'
import { agruparEnTurnos, type Transcriptor } from './index'

interface PalabraDeepgram {
  word: string
  punctuated_word?: string
  start: number
  end: number
  speaker?: number
}

/**
 * Deepgram acepta el audio en el cuerpo del POST y devuelve la transcripcion
 * completa en una sola llamada, con diarizacion incluida. Es el camino mas
 * corto para el espaniol y no obliga a exponer el audio en una URL publica.
 */
export const transcriptorDeepgram: Transcriptor = {
  nombre: 'deepgram',
  async transcribir(rutaAudio, idioma) {
    if (!config.deepgramKey) throw new Error('Falta DEEPGRAM_API_KEY')

    const p = new URLSearchParams({
      model: 'nova-3',
      language: idioma,
      diarize: 'true',
      punctuate: 'true',
      smart_format: 'true',
    })
    const r = await fetch(`https://api.deepgram.com/v1/listen?${p}`, {
      method: 'POST',
      headers: {
        authorization: `Token ${config.deepgramKey}`,
        'content-type': 'audio/webm',
      },
      body: Readable.toWeb(createReadStream(rutaAudio)) as ReadableStream,
      // @ts-expect-error duplex es parte de fetch en Node pero no del tipo DOM
      duplex: 'half',
    })
    if (!r.ok) throw new Error(`Deepgram fallo: ${r.status} ${await r.text()}`)

    const datos = (await r.json()) as {
      metadata?: { duration?: number }
      results?: {
        channels?: { alternatives?: { words?: PalabraDeepgram[] }[] }[]
      }
    }
    const palabras = datos.results?.channels?.[0]?.alternatives?.[0]?.words ?? []

    return {
      idioma,
      duracionSeg: Math.round(datos.metadata?.duration ?? 0),
      turnos: agruparEnTurnos(
        palabras.map((w) => ({
          texto: w.punctuated_word ?? w.word,
          desde: w.start,
          hasta: w.end,
          hablante: w.speaker ?? 0,
        })),
      ),
    } satisfies Transcripcion
  },
}
