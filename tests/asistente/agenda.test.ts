import { describe, expect, it } from 'vitest'
import { cargar, TODOS } from './cargar'

const f = cargar(...TODOS)

describe('clasificarItem', () => {
  it('una reunión con fecha va al calendario', () => {
    expect(f.clasificarItem({ tipo: 'evento', plazo: '2026-09-26' })).toBe('evento')
  })

  it('algo con hora es un momento, no un plazo: va al calendario aunque el modelo diga tarea', () => {
    expect(f.clasificarItem({ tipo: 'tarea', plazo: '2026-09-28', hora: '10:00' })).toBe('evento')
  })

  it('algo para hacer en un día, sin hora, es una tarea', () => {
    expect(f.clasificarItem({ tipo: 'tarea', plazo: '2026-09-26' })).toBe('tarea')
  })

  it('sin fecha no hay dónde ponerlo en el calendario: queda como tarea', () => {
    expect(f.clasificarItem({ tipo: 'evento', plazo: '', hora: '17:00' })).toBe('tarea')
  })
})

describe('horas', () => {
  it('reconoce y normaliza las horas', () => {
    expect(f.esHora('17:00')).toBe(true)
    expect(f.esHora('9:30')).toBe(true)
    expect(f.esHora('25:00')).toBe(false)
    expect(f.esHora('5 de la tarde')).toBe(false)
    expect(f.normalizarHora('9:30')).toBe('09:30')
    expect(f.normalizarHora('basura')).toBe('')
  })

  it('dice el día y la hora como se dicen', () => {
    expect(f.formatearCuando('2026-09-26', '17:00', '2026-09-25')).toBe('mañana 17:00')
    expect(f.formatearCuando('2026-09-26', '', '2026-09-25')).toBe('mañana')
    expect(f.formatearCuando('', '17:00', '2026-09-25')).toBe('')
  })

  it('un evento de ayer ya ocurrió; una tarea de ayer sigue pendiente, vencida', () => {
    expect(f.yaOcurrio({ tipo: 'evento', plazo: '2026-09-24' }, '2026-09-25')).toBe(true)
    expect(f.yaOcurrio({ tipo: 'evento', plazo: '2026-09-25' }, '2026-09-25')).toBe(false)
    expect(f.yaOcurrio({ tipo: 'tarea', plazo: '2026-09-24' }, '2026-09-25')).toBe(false)
  })
})

describe('planDeSincronizacion', () => {
  const t = (numero: number, estado: string, idTasks = '', tipo = 'tarea') => ({ numero, estado, idTasks, tipo })

  it('crea en Google Tasks lo abierto que todavía no está', () => {
    const plan = f.planDeSincronizacion([t(1, 'abierta')], {})
    expect(plan.crear.map((x: any) => x.numero)).toEqual([1])
  })

  it('cierra en la base lo que la persona marcó como hecho en Google Tasks', () => {
    const plan = f.planDeSincronizacion([t(1, 'abierta', 'a')], { a: 'completed' })
    expect(plan.cerrarEnBase.map((x: any) => x.numero)).toEqual([1])
  })

  it('marca como hecho en Google Tasks lo que se cerró por Chat', () => {
    const plan = f.planDeSincronizacion([t(1, 'cerrada', 'a')], { a: 'needsAction' })
    expect(plan.completarEnTasks.map((x: any) => x.numero)).toEqual([1])
  })

  it('no vuelve a crear lo que la persona borró de su lista a propósito', () => {
    const plan = f.planDeSincronizacion([t(1, 'abierta', 'borrada')], {})
    expect(plan.crear).toHaveLength(0)
    expect(plan.cerrarEnBase).toHaveLength(0)
  })

  it('los eventos no van a Google Tasks', () => {
    const plan = f.planDeSincronizacion([t(1, 'abierta', '', 'evento')], {})
    expect(plan.crear).toHaveLength(0)
  })

  it('si ya coinciden, no hay nada que hacer', () => {
    const plan = f.planDeSincronizacion([t(1, 'abierta', 'a'), t(2, 'cerrada', 'b')], { a: 'needsAction', b: 'completed' })
    expect(plan.crear.length + plan.cerrarEnBase.length + plan.completarEnTasks.length).toBe(0)
  })
})

describe('datosDeMinuta', () => {
  it('deja la minuta en una forma estable, con cada compromiso atado a su tarea', () => {
    const d = f.datosDeMinuta(
      { id: 'abc123', recibida: '2026-09-25 10:00', grabo: 'Fernando', email: 'f@x.com', nota: '' },
      { titulo: 'Comité', resumen: 'R', participantes: [{ nombre: 'Diana' }], decisiones: ['D'], preguntasAbiertas: [], riesgos: [] },
      '2026-09-25',
      42,
      { minuta: 'doc', carpeta: 'dir', audio: 'wav' },
      [{ tarea: { numero: 7, que: 'Cerrar precio', responsable: 'Diana', emailResponsable: 'd@x.com', plazo: '2026-09-29' } }],
    )
    expect(d).toMatchObject({ version: 1, tipo: 'minuta', id: 'abc123', duracionMinutos: 42 })
    expect(d.compromisos).toEqual([{ tarea: 7, que: 'Cerrar precio', responsable: 'Diana', email: 'd@x.com', plazo: '2026-09-29' }])
    expect(d.participantes).toEqual([{ nombre: 'Diana', rol: '' }])
  })
})
