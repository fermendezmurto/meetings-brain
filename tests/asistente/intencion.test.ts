import { describe, expect, it } from 'vitest'
import { cargar, TODOS } from './cargar'

const { interpretarComando } = cargar(...TODOS)

describe('interpretarComando', () => {
  it.each([
    ['pendientes', 'pendientes'],
    ['¿Qué tengo pendiente?', 'pendientes'],
    ['mis tareas', 'pendientes'],
    ['/pendientes', 'pendientes'],
    ['pedidos', 'pedidos'],
    ['¿Qué pedí?', 'pedidos'],
    ['ayuda', 'ayuda'],
    ['Hola', 'ayuda'],
  ])('"%s" es %s', (texto, tipo) => {
    expect(interpretarComando(texto).tipo).toBe(tipo)
  })

  it.each([
    ['listo 12', 12],
    ['Listo #12', 12],
    ['hecho 3', 3],
    ['cerrar la 7', 7],
    ['ok 40', 40],
  ])('"%s" cierra la %i', (texto, numero) => {
    expect(interpretarComando(texto)).toEqual({ tipo: 'cerrar', numero })
  })

  it('una frase con "listo" en el medio no cierra nada', () => {
    const r = interpretarComando('cuando esté listo el informe mandáselo a Diana')
    expect(r.tipo).toBe('libre')
  })

  it('todo lo demás va al modelo con el texto original', () => {
    expect(interpretarComando('Pedile a Diana el presupuesto para el viernes')).toEqual({
      tipo: 'libre',
      texto: 'Pedile a Diana el presupuesto para el viernes',
    })
  })
})
