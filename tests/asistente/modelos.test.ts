import { describe, expect, it } from 'vitest'
import { cargar, TODOS } from './cargar'

const { configRazonamiento, mensajeModeloRetirado } = cargar(...TODOS)

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
