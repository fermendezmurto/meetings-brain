import { describe, expect, it } from 'vitest'
import { cargar, TODOS } from './cargar'

const { configRazonamiento, modeloDeRespaldo, elegirModeloLiviano, modeloDelIntento, mensajeModeloRetirado, esErrorPasajero, convieneReintentar } = cargar(...TODOS)

describe('configRazonamiento', () => {
  it('a la familia 2.5 Flash le acota el razonamiento con un presupuesto', () => {
    expect(configRazonamiento('gemini-2.5-flash', 0)).toEqual({ thinkingBudget: 0 })
    expect(configRazonamiento('gemini-2.5-flash-lite', 1024)).toEqual({ thinkingBudget: 1024 })
  })

  it('a la familia 3 en adelante, con un nivel', () => {
    expect(configRazonamiento('gemini-3.6-flash', 0)).toEqual({ thinkingLevel: 'low' })
    expect(configRazonamiento('gemini-4-flash', 1024)).toEqual({ thinkingLevel: 'low' })
  })

  it('a un modelo que no conoce no le manda nada, para no provocar un error', () => {
    expect(configRazonamiento('gemini-2.0-flash', 0)).toBeNull()
    expect(configRazonamiento('otro-modelo', 0)).toBeNull()
  })

  it('si no se pidió acotarlo, no lo acota', () => {
    expect(configRazonamiento('gemini-3.6-flash', undefined)).toBeNull()
  })
})

describe('mensajeModeloRetirado', () => {
  it('nombra la propiedad que corresponde al modelo retirado', () => {
    expect(mensajeModeloRetirado('gemini-x-lite', 'use models/gemini-y-lite', 'GEMINI_MODEL_NOTAS'))
      .toContain('poné GEMINI_MODEL_NOTAS = gemini-y-lite')
  })

  it('traduce el error de Google a qué tocar', () => {
    // El mensaje real que devolvió Google al instalar.
    const cuerpo = JSON.stringify({
      error: {
        code: 404,
        message: 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash for the latest features and improvements.',
        status: 'NOT_FOUND',
      },
    })
    expect(mensajeModeloRetirado('gemini-2.5-flash', cuerpo)).toBe(
      'Google retiró el modelo gemini-2.5-flash. En Propiedades del script, poné GEMINI_MODEL = gemini-3.6-flash y volvé a probar.',
    )
  })

  it('si Google no sugiere reemplazo, igual dice dónde cambiarlo', () => {
    expect(mensajeModeloRetirado('gemini-x', 'not found')).toContain('cambiá GEMINI_MODEL')
  })
})

describe('errores pasajeros', () => {
  it('la saturación y las fallas momentáneas del servidor se arreglan solas', () => {
    expect([500, 502, 503, 504].every(esErrorPasajero)).toBe(true)
    expect([400, 401, 403, 404, 429].some(esErrorPasajero)).toBe(false)
  })

  it('se reintenta si queda tiempo antes del corte, no según cuánto tardó el primer intento', () => {
    // En la primera prueba real Google tardó en decir "saturado", y la regla
    // anterior, basada en esa demora, dejó afuera al respaldo justo ahí.
    expect(convieneReintentar(503, 12000)).toBe(true)
    // Con menos de 10 segundos no da para contestar, anotar y agendar antes
    // de que Chat deje de esperar.
    expect(convieneReintentar(503, 9000)).toBe(false)
    // Sin corte, como en las reuniones, siempre hay tiempo.
    expect(convieneReintentar(503, undefined)).toBe(true)
    expect(convieneReintentar(400, 20000)).toBe(false)
  })
})

describe('modeloDeRespaldo', () => {
  it('usa el configurado, salvo que sea el mismo modelo o se haya apagado', () => {
    expect(modeloDeRespaldo('gemini-3.6-flash', 'gemini-3.5-flash-lite')).toBe('gemini-3.5-flash-lite')
    expect(modeloDeRespaldo('gemini-3.6-flash', 'gemini-3.6-flash')).toBe('')
    expect(modeloDeRespaldo('gemini-3.6-flash', 'ninguno')).toBe('')
    expect(modeloDeRespaldo('gemini-3.6-flash', 'Ninguno')).toBe('')
    expect(modeloDeRespaldo('gemini-3.6-flash', '')).toBe('')
  })
})

describe('elegirModeloLiviano', () => {
  it('elige el liviano estable más nuevo de la lista de Google', () => {
    expect(elegirModeloLiviano([
      'models/gemini-3.6-flash', 'models/gemini-3.5-flash-lite', 'models/gemini-2.5-flash-lite',
      'models/gemini-3.9-flash-lite-preview', 'models/gemini-3.8-flash',
    ])).toBe('gemini-3.5-flash-lite')
  })

  it('si solo hay versiones de prueba, usa la más nueva', () => {
    expect(elegirModeloLiviano(['models/gemini-3.9-flash-lite-preview', 'models/gemini-3.7-flash-lite-preview']))
      .toBe('gemini-3.9-flash-lite-preview')
  })

  it('si no hay ninguno liviano, no inventa', () => {
    expect(elegirModeloLiviano(['models/gemini-3.6-flash'])).toBe('')
  })
})

describe('modeloDelIntento', () => {
  it('alterna los modelos disponibles, porque cada uno tiene su capacidad', () => {
    const turno = ['liviano', 'grande']
    expect([0, 1, 2, 3, 4].map((n) => modeloDelIntento(turno, n))).toEqual(['liviano', 'grande', 'liviano', 'grande', 'liviano'])
    expect([0, 1, 2].map((n) => modeloDelIntento(['unico'], n))).toEqual(['unico', 'unico', 'unico'])
  })
})
