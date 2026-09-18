import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { config } from '../config'
import type { Transcripcion } from '../types'
import { agruparEnTurnos, type Transcriptor } from './index'

const API = 'https://api.assemblyai.com/v2'

/**
 * AssemblyAI trabaja en dos pasos: primero se sube el audio, despues se pide la
 * transcripcion y se espera. Separa mejor las voces que Deepgram en salas con
 * varias personas sobre un solo microfono, que es el caso de la reunion
 * presencial; a cambio tarda mas.
 */
export const transcriptorAssemblyAI: Transcriptor = {
  nombre: 'assemblyai',
  async transcribir(rutaAudio, idioma) {
    if (!config.assemblyaiKey) throw new Error('Falta ASSEMBLYAI_API_KEY')
    const cabeceras = { authorization: config.assemblyaiKey }

    const subida = await fetch(`${API}/upload`, {
      method: 'POST',
      headers: { ...cabeceras, 'content-type': 'application/octet-stream' },
      body: Readable.toWeb(createReadStream(rutaAudio)) as ReadableStream,
      // @ts-expect-error duplex es parte de fetch en Node pero no del tipo DOM
      duplex: 'half',
    })
    if (!subida.ok) throw new Error(`AssemblyAI no acepto el audio: ${await subida.text()}`)
    const { upload_url } = (await subida.json()) as { upload_url: string }

    const pedido = await fetch(`${API}/transcript`, {
      method: 'POST',
      headers: { ...cabeceras, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: upload_url,
        language_code: idioma,
        speaker_labels: true,
        punctuate: true,
        format_text: true,
      }),
    })
    if (!pedido.ok) throw new Error(`AssemblyAI fallo: ${await pedido.text()}`)
    const { id } = (await pedido.json()) as { id: string }

    // Sondeo con espera fija: una reunion larga puede tardar varios minutos.
    for (let intento = 0; intento < 240; intento++) {
      await new Promise((r) => setTimeout(r, 5000))
      const estado = await fetch(`${API}/transcript/${id}`, { headers: cabeceras })
      const t = (await estado.json()) as {
        status: string
        error?: string
        audio_duration?: number
        words?: { text: string; start: number; end: number; speaker?: string }[]
      }
      if (t.status === 'error') throw new Error(`AssemblyAI fallo: ${t.error}`)
      if (t.status !== 'completed') continue

      return {
        idioma,
        duracionSeg: Math.round(t.audio_duration ?? 0),
        turnos: agruparEnTurnos(
          (t.words ?? []).map((w) => ({
            texto: w.text,
            // AssemblyAI mide en milisegundos; el resto del sistema en segundos.
            desde: w.start / 1000,
            hasta: w.end / 1000,
            // Devuelve "A", "B", "C": se pasa a indice para hablar un solo idioma.
            hablante: (w.speaker ?? 'A').charCodeAt(0) - 65,
          })),
        ),
      } satisfies Transcripcion
    }
    throw new Error('AssemblyAI no respondio a tiempo')
  },
}
