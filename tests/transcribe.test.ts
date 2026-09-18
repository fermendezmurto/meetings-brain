import { describe, expect, it } from 'vitest'
import { agruparEnTurnos } from '@/lib/transcribe'

describe('agruparEnTurnos', () => {
  it('junta las palabras seguidas de la misma voz en un solo turno', () => {
    const turnos = agruparEnTurnos([
      { texto: 'Hola', desde: 0, hasta: 0.5, hablante: 0 },
      { texto: 'a', desde: 0.5, hasta: 0.7, hablante: 0 },
      { texto: 'todos.', desde: 0.7, hasta: 1.2, hablante: 0 },
      { texto: 'Buenas.', desde: 1.5, hasta: 2, hablante: 1 },
      { texto: 'Arrancamos.', desde: 2.1, hasta: 3, hablante: 0 },
    ])
    expect(turnos).toHaveLength(3)
    expect(turnos[0]).toEqual({ hablante: 0, desde: 0, hasta: 1.2, texto: 'Hola a todos.' })
    // La voz 0 vuelve a hablar: es un turno nuevo, no se pega al primero.
    expect(turnos[2].texto).toBe('Arrancamos.')
  })

  it('sin palabras devuelve vacio en lugar de romper', () => {
    expect(agruparEnTurnos([])).toEqual([])
  })
})
