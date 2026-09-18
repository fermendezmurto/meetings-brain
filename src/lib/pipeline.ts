import { promises as fs } from 'node:fs'
import path from 'node:path'
import { armarAudio } from './blobs'
import { config } from './config'
import { asegurarRuta, subirArchivo, subirContenido } from './drive'
import { tokenVigente } from './google'
import { aHtml, aMarkdown, nombreCarpeta } from './minuta'
import { renderizarTranscripcion } from './speakers'
import { actualizar, leer } from './store'
import { elegirResumidor } from './summarize'
import { elegirTranscriptor } from './transcribe'
import type { Grabacion } from './types'

/**
 * Todo lo que pasa despues de apretar "terminar": transcribir, escribir la
 * minuta y dejarla en Drive.
 *
 * Corre en segundo plano y va dejando el estado en la ficha, para que el
 * telefono pueda cerrarse sin esperar. Si algo falla, queda el error escrito y
 * la grabacion se puede reintentar sin volver a grabar nada.
 */
export async function procesar(id: string, sid: string): Promise<void> {
  try {
    await actualizar(id, (g) => ({ ...g, estado: 'transcribiendo', error: null }))
    const g = await leer(id)
    if (!g) throw new Error(`No existe la grabacion ${id}`)

    const rutaAudio = await armarAudio(id)

    const transcripcion = await elegirTranscriptor().transcribir(rutaAudio, 'es')
    await actualizar(id, (x) => ({
      ...x,
      transcripcion,
      // La duracion que mide el cliente manda: el contenedor webm armado por
      // trozos no trae metadatos de duracion confiables.
      duracionSeg: x.duracionSeg || transcripcion.duracionSeg,
      estado: 'resumiendo',
    }))

    const minuta = await elegirResumidor().resumir(transcripcion, {
      titulo: g.titulo,
      fecha: g.creadaEn.slice(0, 10),
      participantesPrevios: g.participantesPrevios,
    })
    const conMinuta = await actualizar(id, (x) => ({
      ...x,
      minuta,
      titulo: minuta.titulo || x.titulo,
      estado: 'subiendo',
    }))
    if (!conMinuta) throw new Error('La ficha desaparecio a mitad del proceso')

    const destino = await publicar(conMinuta, rutaAudio, sid)
    await actualizar(id, (x) => ({ ...x, drive: destino, estado: 'listo' }))
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    await actualizar(id, (x) => ({ ...x, estado: 'error', error: mensaje }))
    throw e
  }
}

/** Deja audio, transcripcion y minuta en su carpeta. */
async function publicar(
  g: Grabacion,
  rutaAudio: string,
  sid: string,
): Promise<Grabacion['drive']> {
  const minuta = g.minuta!
  const carpeta = nombreCarpeta(g, minuta.titulo)
  const texto = renderizarTranscripcion(g.transcripcion!, minuta.participantes)
  const markdown = aMarkdown(minuta, g)

  if (config.destino === 'mock') {
    // Modo de prueba: mismo arbol de carpetas, pero en disco.
    const dir = path.join(
      process.cwd(),
      '.data',
      'salida',
      g.creadaEn.slice(0, 4),
      g.creadaEn.slice(5, 7),
      carpeta,
    )
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(rutaAudio, path.join(dir, 'audio.webm'))
    await fs.writeFile(path.join(dir, 'transcripcion.txt'), texto, 'utf8')
    await fs.writeFile(path.join(dir, 'minuta.md'), markdown, 'utf8')
    return { carpetaId: dir, audioId: 'local', minutaId: 'local' }
  }

  const token = await tokenVigente(sid)
  const carpetaId = await asegurarRuta(token, [
    'Reuniones',
    g.creadaEn.slice(0, 4),
    g.creadaEn.slice(5, 7),
    carpeta,
  ])

  const audioId = await subirArchivo(token, rutaAudio, {
    nombre: 'audio.webm',
    mimeType: 'audio/webm',
    padreId: carpetaId,
  })
  await subirContenido(token, texto, {
    nombre: 'transcripcion.txt',
    mimeType: 'text/plain',
    padreId: carpetaId,
  })
  const minutaId = await subirContenido(token, aHtml(minuta, g), {
    nombre: minuta.titulo,
    mimeType: 'text/html',
    // Se sube como HTML y Drive lo convierte en documento de Google, editable.
    convertirA: 'application/vnd.google-apps.document',
    padreId: carpetaId,
  })

  return { carpetaId, audioId, minutaId }
}
