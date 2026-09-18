import type { Minuta } from '../types'
import { hablantes } from '../speakers'
import type { Resumidor } from './index'

/** Minuta de prueba: arma algo coherente con la transcripcion sin llamar a nadie. */
export const resumidorMock: Resumidor = {
  nombre: 'mock',
  async resumir(t, ctx) {
    const voces = hablantes(t)
    return {
      titulo: ctx.titulo,
      resumen: `Reunion de ${Math.round(t.duracionSeg / 60)} minutos con ${voces.length} voces. Minuta generada en modo de prueba.`,
      participantes: voces.map((v, i) => ({
        nombre: ctx.participantesPrevios[i] ?? `Hablante ${v.hablante + 1}`,
        hablante: v.hablante,
        origen: ctx.participantesPrevios[i] ? 'calendario' : 'dicho',
      })),
      decisiones: ['Decision de prueba registrada por el adaptador mock.'],
      compromisos: [
        { que: 'Compromiso de prueba', duenio: ctx.participantesPrevios[0] ?? null, plazo: null },
      ],
      preguntasAbiertas: ['Pregunta de prueba'],
      riesgos: [],
      temas: ['prueba'],
    } satisfies Minuta
  },
}
