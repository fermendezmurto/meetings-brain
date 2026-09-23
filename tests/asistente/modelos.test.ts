import { describe, expect, it } from 'vitest'
import { cargar, TODOS } from './cargar'

const { configRazonamiento, modeloDeRespaldo, mensajeModeloRetirado, esErrorPasajero, convieneReintentar } = cargar(...TODOS)

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

  it('se reintenta solo si el fallo fue rápido, para no pasar el límite de Chat', () => {
    expect(convieneReintentar(503, 800)).toBe(true)
    // El 503 real que devolvió Google tardó bastante: reintentar ahí deja a la
    // persona sin respuesta.
    expect(convieneReintentar(503, 30000)).toBe(false)
    expect(convieneReintentar(400, 800)).toBe(false)
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
