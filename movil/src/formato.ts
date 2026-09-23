import type { Grabacion } from './almacen'

/** "4:07" o "1:02:03". */
export function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const dos = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${dos(m)}:${dos(s % 60)}` : `${m}:${dos(s % 60)}`
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** "jue 25/09 14:30", en la hora del teléfono. */
export function cuando(ms: number): string {
  const d = new Date(ms)
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${DIAS[d.getDay()]} ${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}`
}

/** Qué mostrarle a la persona sobre cada grabación, y si hay algo para tocar. */
export function estadoVisible(g: Grabacion): { texto: string; tono: 'normal' | 'bien' | 'mal'; accion?: 'minuta' | 'reintentar' } {
  if (g.estado === 'pendiente') return { texto: 'Esperando para enviar', tono: 'normal' }
  if (g.estado === 'subiendo') {
    const pct = g.tamanio ? Math.floor((g.recibidos / g.tamanio) * 100) : 0
    return { texto: `Enviando… ${pct}%`, tono: 'normal' }
  }
  if (g.estado === 'fallo') {
    return { texto: g.definitivo ? g.error ?? 'No se pudo enviar' : 'Sin conexión. Se reintenta sola.', tono: 'mal', accion: 'reintentar' }
  }
  if (g.minuta) return { texto: g.titulo || 'Minuta lista', tono: 'bien', accion: 'minuta' }
  if (g.estadoAsistente === 'error') return { texto: 'El Asistente no pudo procesarla. Te avisó por correo.', tono: 'mal' }
  return { texto: 'Enviada. La minuta te llega por correo en unos minutos.', tono: 'normal' }
}
