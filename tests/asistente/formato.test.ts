import { describe, expect, it } from 'vitest'
import { cargar, TODOS } from './cargar'

const f = cargar(...TODOS)
const HOY = '2026-09-25'

const tareas = [
  { numero: 3, que: 'Sin fecha', responsable: 'Diana', plazo: '' },
  { numero: 7, que: 'Para el martes', responsable: 'Diana', plazo: '2026-09-29' },
  { numero: 5, que: 'Atrasada', responsable: 'Diana', plazo: '2026-09-20' },
]

describe('listarPendientes', () => {
  it('pone arriba lo vencido y abajo lo que no tiene fecha', () => {
    const texto = f.listarPendientes(tareas, HOY)
    expect(texto.indexOf('#5*')).toBeLessThan(texto.indexOf('#7*'))
    expect(texto.indexOf('#7*')).toBeLessThan(texto.indexOf('#3*'))
  })

  it('resalta lo vencido', () => {
    expect(f.listarPendientes(tareas, HOY)).toContain('*vencida: dom 20/09*')
  })

  it('sin tareas lo dice en vez de mandar una lista vacía', () => {
    expect(f.listarPendientes([], HOY)).toBe('No tenés nada pendiente.')
  })
})

describe('confirmarAnotadas', () => {
  it('dice a quién no se le pudo avisar', () => {
    const texto = f.confirmarAnotadas('Anoté un pedido.', [
      {
        tarea: { numero: 9, que: 'Enviar el presupuesto', responsable: 'Juan', plazo: '2026-09-26' },
        problema: 'Hay dos Juan: decime cuál.',
      },
    ], HOY)
    expect(texto).toContain('*#9* Enviar el presupuesto — Juan · mañana')
    expect(texto).toContain('Hay dos Juan')
  })
})

describe('renderizarTurnos', () => {
  it('escribe minuto y nombre de quien habla', () => {
    const texto = f.renderizarTurnos([
      { desde: 0, quien: 'Diana', texto: 'Arrancamos.' },
      { desde: 3725, quien: 'Hablante 2', texto: 'Dale.' },
    ])
    expect(texto).toBe('[00:00] Diana: Arrancamos.\n[1:02:05] Hablante 2: Dale.')
  })
})

describe('seccionesMinuta', () => {
  it('escribe el compromiso con responsable y plazo, o dice que faltan', () => {
    const s = f.seccionesMinuta({
      participantes: [],
      decisiones: [],
      compromisos: [
        { que: 'Cerrar el precio', responsable: 'Diana', plazo: '2026-09-29' },
        { que: 'Revisar el contrato' },
      ],
    })
    const compromisos = s.find((x: any) => x.titulo === 'Compromisos').items
    expect(compromisos).toEqual([
      'Cerrar el precio — Diana, para el mar 29/09',
      'Revisar el contrato — sin responsable, sin plazo',
    ])
  })
})

describe('esquemas', () => {
  it('usan los tipos en mayúsculas, como los documenta la API de Gemini', () => {
    const tipos: string[] = []
    const recorrer = (n: any) => {
      if (n && typeof n === 'object') {
        if (typeof n.type === 'string') tipos.push(n.type)
        Object.values(n).forEach(recorrer)
      }
    }
    ;[f.ESQUEMA_NOTA, f.ESQUEMA_MINUTA, f.ESQUEMA_TRAMO].forEach(recorrer)
    expect(tipos.length).toBeGreaterThan(10)
    expect(tipos.every((t) => t === t.toUpperCase())).toBe(true)
  })
})

describe('promptNota', () => {
  it('le da al modelo la fecha y la lista de gente, sin las cuales no puede resolver nada', () => {
    const p = f.promptNota({
      quien: 'Fernando Méndez',
      hoy: HOY,
      hoyLargo: 'viernes 25/09/2026',
      personas: ['Diana Valiente'],
      texto: 'pedile a Diana el presupuesto para el martes',
    })
    expect(p).toContain('viernes 25/09/2026')
    expect(p).toContain('Diana Valiente')
    expect(p).toContain('pedile a Diana el presupuesto')
  })
})

describe('transcripción por tramos', () => {
  it('escribe las marcas de tiempo como las entiende Gemini', () => {
    expect(f.marcaDeTiempo(0)).toBe('00:00')
    expect(f.marcaDeTiempo(10)).toBe('10:00')
    expect(f.marcaDeTiempo(70)).toBe('1:10:00')
  })

  it('pide solo el rango y los nombres de quienes estuvieron', () => {
    const p = f.promptTramo({ desde: 10, hasta: 20, participantes: ['Diana Valiente'] })
    expect(p).toContain('entre 10:00 y 20:00')
    expect(p).toContain('Diana Valiente')
  })

  it('mide la duración por lo que cobró Gemini: 32 unidades por segundo de audio', () => {
    // 45 minutos exactos de audio, más el texto del pedido.
    const uso = { promptTokensDetails: [{ modality: 'TEXT', tokenCount: 900 }, { modality: 'AUDIO', tokenCount: 45 * 60 * 32 }] }
    expect(f.minutosDeAudio(uso)).toBe(45)
    expect(f.minutosDeAudio({})).toBe(0)
  })
})
