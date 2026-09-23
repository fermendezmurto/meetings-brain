import { promises as fs, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { config } from './config'

const BASE = 'https://generativelanguage.googleapis.com'

/**
 * Cliente minimo de la API de Gemini. Se usa para las dos partes caras del
 * circuito: escuchar el audio y escribir la minuta.
 *
 * El audio va por la Files API y no incrustado en el pedido: una reunion de dos
 * horas pesa mas de lo que admite un generateContent normal, y ademas el archivo
 * queda referenciable por URI durante 48 horas sin volver a subirlo.
 */
export async function subirArchivo(
  ruta: string,
  mimeType: string,
  nombre: string,
): Promise<string> {
  const clave = exigirClave()
  const { size } = await fs.stat(ruta)

  const inicio = await fetch(`${BASE}/upload/v1beta/files?key=${clave}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: nombre } }),
  })
  if (!inicio.ok) throw new Error(`Gemini rechazo la subida: ${await inicio.text()}`)

  const urlSubida = inicio.headers.get('x-goog-upload-url')
  if (!urlSubida) throw new Error('Gemini no devolvio URL de subida')

  // El audio va por streaming: una reunion larga no tiene por que pasar entera
  // por la memoria del servidor, que en un plan chico son 512 MB.
  const subida = await fetch(urlSubida, {
    method: 'POST',
    headers: {
      'content-length': String(size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: Readable.toWeb(createReadStream(ruta)) as ReadableStream,
    // @ts-expect-error duplex es parte de fetch en Node pero no del tipo DOM
    duplex: 'half',
  })
  if (!subida.ok) throw new Error(`Gemini fallo al subir: ${await subida.text()}`)
  const { file } = (await subida.json()) as {
    file: { uri: string; name: string; state: string }
  }

  await esperarProcesado(file.name)
  return file.uri
}

/** Gemini tarda unos segundos en dejar el audio listo para usar. */
async function esperarProcesado(nombre: string): Promise<void> {
  const clave = exigirClave()
  for (let intento = 0; intento < 60; intento++) {
    const r = await fetch(`${BASE}/v1beta/${nombre}?key=${clave}`)
    if (!r.ok) throw new Error(`Gemini fallo al consultar el archivo: ${await r.text()}`)
    const { state } = (await r.json()) as { state: string }
    if (state === 'ACTIVE') return
    if (state === 'FAILED') throw new Error('Gemini no pudo procesar el audio')
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('Gemini tardo demasiado en procesar el audio')
}

export interface ParteArchivo {
  file_data: { mime_type: string; file_uri: string }
}

/**
 * Pide una respuesta en JSON con forma fija. El esquema no es decorativo: sin el,
 * el modelo devuelve prosa y la minuta deja de ser parseable.
 */
export async function pedirJson<T>(
  partes: (ParteArchivo | { text: string })[],
  esquema: Record<string, unknown>,
  modelo = config.geminiModelo,
): Promise<T> {
  const clave = exigirClave()
  const r = await fetch(
    `${BASE}/v1beta/models/${modelo}:generateContent?key=${clave}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: partes }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: esquema,
          temperature: 0.2,
        },
      }),
    },
  )
  if (!r.ok) throw new Error(`Gemini fallo: ${r.status} ${await r.text()}`)

  const datos = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const texto = datos.candidates?.[0]?.content?.parts?.[0]?.text
  if (!texto) throw new Error('Gemini devolvio una respuesta vacia')
  return JSON.parse(texto) as T
}

function exigirClave(): string {
  if (!config.geminiKey) throw new Error('Falta GEMINI_API_KEY')
  return config.geminiKey
}
