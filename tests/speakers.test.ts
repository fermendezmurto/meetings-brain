import { describe, expect, it } from 'vitest'
import {
  confirmarHablante,
  hablantes,
  nombreDe,
  reloj,
  renderizarTranscripcion,
} from '@/lib/speakers'
import type { Participante, Transcripcion } from '@/lib/types'

const t: Transcripcion = {
  idioma: 'es',
  duracionSeg: 60,
  turnos: [
    { hablante: 0, desde: 0, hasta: 5, texto: 'Arrancamos con el estado del proyecto.' },
    { hablante: 1, desde: 5, hasta: 35, texto: 'Yo avance con el modelo de precios.' },
    { hablante: 0, desde: 35, hasta: 40, texto: 'Bien.' },
  ],
}

describe('hablantes', () => {
  it('ordena por tiempo hablado, no por orden de aparicion', () => {
    const r = hablantes(t)
    expect(r.map((x) => x.hablante)).toEqual([1, 0])
    expect(r[0].segundos).toBe(30)
    expect(r[1].turnos).toBe(2)
  })

  it('guarda una muestra de lo que dijo cada voz', () => {
    expect(hablantes(t)[0].muestra).toContain('modelo de precios')
  })
})

describe('confirmarHablante', () => {
  const previos: Participante[] = [
    { nombre: 'Hablante 2', hablante: 1, origen: 'dicho' },
    { nombre: 'Fernando', hablante: 0, origen: 'confirmado' },
  ]

  it('reemplaza lo que dedujo el modelo y lo marca como confirmado', () => {
    const r = confirmarHablante(previos, 1, 'Diana')
    expect(r).toContainEqual({ nombre: 'Diana', hablante: 1, origen: 'confirmado', rol: undefined })
    expect(r.find((p) => p.nombre === 'Hablante 2')).toBeUndefined()
    expect(r).toHaveLength(2)
  })

  it('no deja el mismo nombre atado a dos voces', () => {
    // Si alguien dice que el hablante 1 tambien es Fernando, la ficha vieja se va.
    const r = confirmarHablante(previos, 1, 'Fernando')
    expect(r.filter((p) => p.nombre === 'Fernando')).toHaveLength(1)
    expect(r.find((p) => p.nombre === 'Fernando')?.hablante).toBe(1)
  })

  it('con nombre vacio saca al participante en lugar de crear uno sin nombre', () => {
    expect(confirmarHablante(previos, 1, '  ')).toHaveLength(1)
  })
})

describe('reloj', () => {
  it('omite las horas cuando no las hay', () => {
    expect(reloj(75)).toBe('01:15')
    expect(reloj(3725)).toBe('1:02:05')
    expect(reloj(-4)).toBe('00:00')
  })
})

describe('renderizarTranscripcion', () => {
  it('usa el nombre cuando lo hay y el numero de voz cuando no', () => {
    const texto = renderizarTranscripcion(t, [
      { nombre: 'Fernando', hablante: 0, origen: 'confirmado' },
    ])
    expect(texto).toContain('[00:00] Fernando:')
    expect(texto).toContain('[00:05] Hablante 2:')
  })
})

describe('nombreDe', () => {
  it('numera las voces desde 1 para quien lee, no desde 0', () => {
    expect(nombreDe([], 2)).toBe('Hablante 3')
  })
})
