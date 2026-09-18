import type { Participante, Transcripcion } from './types'

export interface ResumenHablante {
  hablante: number
  segundos: number
  turnos: number
  muestra: string
}

/**
 * Cuanto hablo cada voz, de mayor a menor. La app lo usa para preguntar primero
 * por quien mas participo: si la reunion tuvo seis voces, poner nombre a las dos
 * principales ya ordena casi toda la minuta.
 */
export function hablantes(t: Transcripcion): ResumenHablante[] {
  const por = new Map<number, ResumenHablante>()
  for (const turno of t.turnos) {
    const actual = por.get(turno.hablante) ?? {
      hablante: turno.hablante,
      segundos: 0,
      turnos: 0,
      // La primera frase larga sirve de muestra para reconocer a la persona.
      muestra: '',
    }
    actual.segundos += Math.max(0, turno.hasta - turno.desde)
    actual.turnos += 1
    if (actual.muestra.length < 40 && turno.texto.length > actual.muestra.length) {
      actual.muestra = turno.texto.slice(0, 120)
    }
    por.set(turno.hablante, actual)
  }
  return [...por.values()].sort((a, b) => b.segundos - a.segundos)
}

export function nombreDe(participantes: Participante[], hablante: number): string {
  return (
    participantes.find((p) => p.hablante === hablante)?.nombre ??
    `Hablante ${hablante + 1}`
  )
}

/** La transcripcion en texto plano, con nombre y minuto en cada turno. */
export function renderizarTranscripcion(
  t: Transcripcion,
  participantes: Participante[],
): string {
  return t.turnos
    .map((turno) => `[${reloj(turno.desde)}] ${nombreDe(participantes, turno.hablante)}: ${turno.texto}`)
    .join('\n')
}

export function reloj(segundos: number): string {
  const s = Math.max(0, Math.round(segundos))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const dos = (n: number) => String(n).padStart(2, '0')
  return hh > 0 ? `${hh}:${dos(mm)}:${dos(ss)}` : `${dos(mm)}:${dos(ss)}`
}

/**
 * Le pone nombre a una voz. Una confirmacion de una persona pisa siempre lo que
 * dedujo el modelo, y es la que despues sirve para aprender la voz.
 */
export function confirmarHablante(
  participantes: Participante[],
  hablante: number,
  nombre: string,
): Participante[] {
  const limpio = nombre.trim()
  const resto = participantes.filter(
    (p) => p.hablante !== hablante && p.nombre.toLowerCase() !== limpio.toLowerCase(),
  )
  if (!limpio) return resto
  const previo = participantes.find(
    (p) => p.nombre.toLowerCase() === limpio.toLowerCase(),
  )
  return [
    ...resto,
    { nombre: limpio, hablante, origen: 'confirmado', rol: previo?.rol },
  ]
}
