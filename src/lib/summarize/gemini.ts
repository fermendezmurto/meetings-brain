import { pedirJson } from '../gemini'
import type { Minuta } from '../types'
import { reloj } from '../speakers'
import type { Resumidor } from './index'

const ESQUEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    resumen: { type: 'string' },
    participantes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          hablante: { type: 'integer' },
          rol: { type: 'string' },
        },
        required: ['nombre', 'hablante'],
      },
    },
    decisiones: { type: 'array', items: { type: 'string' } },
    compromisos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          que: { type: 'string' },
          duenio: { type: 'string' },
          plazo: { type: 'string' },
        },
        required: ['que'],
      },
    },
    preguntasAbiertas: { type: 'array', items: { type: 'string' } },
    riesgos: { type: 'array', items: { type: 'string' } },
    temas: { type: 'array', items: { type: 'string' } },
  },
  required: ['titulo', 'resumen', 'participantes', 'decisiones', 'compromisos'],
}

/**
 * La minuta se arma sobre el texto, no sobre el audio. El audio ya se pago una
 * vez al transcribir; volver a mandarlo costaria lo mismo de nuevo, y el texto
 * de una reunion de dos horas sale por centesimos.
 */
export const resumidorGemini: Resumidor = {
  nombre: 'gemini',
  async resumir(t, ctx) {
    const transcripcion = t.turnos
      .map((x) => `[${reloj(x.desde)}] Hablante ${x.hablante + 1}: ${x.texto}`)
      .join('\n')

    const conocidos = ctx.participantesPrevios.length
      ? `Personas que se sabe que estuvieron: ${ctx.participantesPrevios.join(', ')}.`
      : 'No hay lista previa de participantes.'

    const instruccion = `Sos quien toma las minutas de una empresa paraguaya. Escribi la minuta de esta reunion.

Titulo provisorio: ${ctx.titulo}
Fecha de la reunion: ${ctx.fecha}
${conocidos}

Para cada voz numerada, deduci de que se dice a quien corresponde: se nombran entre ellos, se saludan, se asignan trabajo. Si no podes saberlo con razonable seguridad, dejala como "Hablante N" en lugar de adivinar un nombre.

- decisiones: solo lo que quedo resuelto en la reunion, no lo que se propuso.
- compromisos: trabajo que alguien se llevo. "duenio" es el nombre de la persona; "plazo" en formato AAAA-MM-DD, resolviendo las fechas relativas contra la fecha de la reunion. Si no se dijo plazo, dejalo vacio.
- preguntasAbiertas: lo que quedo sin responder y alguien tiene que contestar.
- riesgos: lo que puede salir mal y se menciono en la reunion.
- El resumen va en tres a seis frases, en espaniol rioplatense, sin adjetivos de relleno.

No inventes nada que no este en la transcripcion.

Transcripcion:
${transcripcion}`

    const salida = await pedirJson<{
      titulo: string
      resumen: string
      participantes: { nombre: string; hablante: number; rol?: string }[]
      decisiones?: string[]
      compromisos?: { que: string; duenio?: string; plazo?: string }[]
      preguntasAbiertas?: string[]
      riesgos?: string[]
      temas?: string[]
    }>([{ text: instruccion }], ESQUEMA)

    return {
      titulo: salida.titulo || ctx.titulo,
      resumen: salida.resumen ?? '',
      // Lo que dedujo el modelo entra como "dicho": vale hasta que una persona
      // lo confirme, y recien ahi sirve para aprender la voz.
      participantes: (salida.participantes ?? []).map((p) => ({
        nombre: p.nombre,
        hablante: p.hablante,
        origen: 'dicho' as const,
        rol: p.rol,
      })),
      decisiones: salida.decisiones ?? [],
      compromisos: (salida.compromisos ?? []).map((c) => ({
        que: c.que,
        duenio: c.duenio || null,
        plazo: c.plazo || null,
      })),
      preguntasAbiertas: salida.preguntasAbiertas ?? [],
      riesgos: salida.riesgos ?? [],
      temas: salida.temas ?? [],
    } satisfies Minuta
  },
}
