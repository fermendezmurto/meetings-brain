import { describe, expect, it } from 'vitest'
import { aHtml, aMarkdown, nombreCarpeta } from '@/lib/minuta'
import type { Grabacion, Minuta } from '@/lib/types'

const g = {
  id: 'x',
  usuario: 'fer@empresa.com',
  titulo: 'Semanal',
  creadaEn: '2026-09-18T14:00:00.000Z',
  duracionSeg: 3725,
} as Grabacion

const m: Minuta = {
  titulo: 'Semanal de producto',
  resumen: 'Se reviso el estado.',
  participantes: [
    { nombre: 'Fernando', hablante: 0, origen: 'confirmado', rol: 'Marketing' },
    { nombre: 'Hablante 2', hablante: 1, origen: 'dicho' },
  ],
  decisiones: ['El precio va sin IVA.'],
  compromisos: [
    { que: 'Cerrar el corte por segmento', duenio: 'Diana', plazo: '2026-09-25' },
    { que: 'Revisar la integracion', duenio: null, plazo: null },
  ],
  preguntasAbiertas: [],
  riesgos: [],
  temas: ['precios'],
}

describe('aMarkdown', () => {
  const md = aMarkdown(m, g)

  it('marca los participantes que el modelo dedujo pero nadie confirmo', () => {
    expect(md).toContain('- Fernando (Marketing)')
    expect(md).toContain('- Hablante 2 — sin confirmar')
  })

  it('deja explicito el compromiso sin dueño en vez de esconderlo', () => {
    expect(md).toContain('**Diana**, para el 2026-09-25')
    expect(md).toContain('**sin dueño**, sin plazo')
  })

  it('no deja secciones vacias sin texto', () => {
    expect(md).toContain('_Ninguna_')
    expect(md).toContain('_Ninguno mencionado_')
  })

  it('muestra la duracion en horas cuando pasa de una', () => {
    expect(md).toContain('1:02:05')
  })
})

describe('aHtml', () => {
  it('escapa lo que vino del audio para que no rompa el documento', () => {
    const html = aHtml({ ...m, resumen: 'Subio <b>20%</b> & cerro' }, g)
    expect(html).toContain('Subio &lt;b&gt;20%&lt;/b&gt; &amp; cerro')
  })
})

describe('nombreCarpeta', () => {
  it('antepone la fecha para que Drive ordene solo', () => {
    expect(nombreCarpeta(g, 'Semanal')).toBe('2026-09-18 — Semanal')
  })

  it('saca los caracteres que rompen nombres de archivo', () => {
    // Los dos puntos, la barra y el signo de cierre rompen la sincronizacion de
    // Drive en Windows; el de apertura no molesta y se deja.
    expect(nombreCarpeta(g, 'Precios: Q3/Q4 ¿cerrado?')).toBe(
      '2026-09-18 — Precios Q3 Q4 ¿cerrado',
    )
  })

  it('no deja la carpeta sin nombre si el titulo queda vacio', () => {
    expect(nombreCarpeta(g, '///')).toBe('2026-09-18 — Reunión')
  })
})
