import { describe, expect, it } from 'vitest'
import { cargar, TODOS } from './cargar'

const { formatearPlazo, fechaParaElModelo, normalizarFecha } = cargar(...TODOS)

// 2026-09-25 es viernes.
const HOY = '2026-09-25'

describe('formatearPlazo', () => {
  it('dice hoy y mañana como se dice en la oficina', () => {
    expect(formatearPlazo('2026-09-25', HOY)).toBe('hoy')
    expect(formatearPlazo('2026-09-26', HOY)).toBe('mañana')
  })

  it('más adelante, día de la semana y fecha', () => {
    expect(formatearPlazo('2026-09-29', HOY)).toBe('mar 29/09')
  })

  it('marca lo vencido', () => {
    expect(formatearPlazo('2026-09-22', HOY)).toBe('vencida: mar 22/09')
  })

  it('cruza de mes y de año sin correrse un día', () => {
    expect(formatearPlazo('2026-10-01', HOY)).toBe('jue 01/10')
    expect(formatearPlazo('2027-01-01', '2026-12-31')).toBe('mañana')
  })

  it('sin plazo o con basura no inventa nada', () => {
    expect(formatearPlazo('', HOY)).toBe('')
    expect(formatearPlazo('el viernes', HOY)).toBe('')
  })
})

describe('fechaParaElModelo', () => {
  it('le da al modelo el día de la semana, que es lo que necesita para "el viernes"', () => {
    expect(fechaParaElModelo(HOY)).toBe('viernes 25/09/2026')
  })
})

describe('normalizarFecha', () => {
  it('entiende las formas en que un modelo devuelve una fecha', () => {
    expect(normalizarFecha('2026-09-25', HOY)).toBe('2026-09-25')
    expect(normalizarFecha('2026-09-25T00:00:00Z', HOY)).toBe('2026-09-25')
    expect(normalizarFecha('2026-9-5', HOY)).toBe('2026-09-05')
    expect(normalizarFecha('25/09/2026', HOY)).toBe('2026-09-25')
    expect(normalizarFecha('25/09/26', HOY)).toBe('2026-09-25')
    expect(normalizarFecha(' 2/10 ', HOY)).toBe('2026-10-02')
  })

  it('sin año, una fecha que ya pasó es del año que viene', () => {
    expect(normalizarFecha('15/01', '2026-12-20')).toBe('2027-01-15')
  })

  it('lo que no es una fecha, o no existe, queda vacío en vez de inventar', () => {
    expect(normalizarFecha('el viernes', HOY)).toBe('')
    expect(normalizarFecha('31/02/2026', HOY)).toBe('')
    expect(normalizarFecha('', HOY)).toBe('')
    expect(normalizarFecha(undefined, HOY)).toBe('')
  })
})
