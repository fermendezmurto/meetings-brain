import type { Grabacion, Minuta } from './types'
import { reloj } from './speakers'

function lista(items: string[], vacio: string): string {
  return items.length ? items.map((x) => `- ${x}`).join('\n') : `_${vacio}_`
}

/** La minuta en markdown: lo que se guarda como texto y se manda por correo. */
export function aMarkdown(m: Minuta, g: Grabacion): string {
  const fecha = g.creadaEn.slice(0, 10)
  const participantes = m.participantes.length
    ? m.participantes
        .map((p) => `- ${p.nombre}${p.rol ? ` (${p.rol})` : ''}${p.origen === 'dicho' ? ' — sin confirmar' : ''}`)
        .join('\n')
    : '_Sin participantes identificados_'

  const compromisos = m.compromisos.length
    ? m.compromisos
        .map((c) => `- ${c.que} — **${c.duenio ?? 'sin dueño'}**${c.plazo ? `, para el ${c.plazo}` : ', sin plazo'}`)
        .join('\n')
    : '_Nadie se llevó trabajo_'

  return `# ${m.titulo}

**Fecha:** ${fecha}
**Duración:** ${reloj(g.duracionSeg)}
**Grabó:** ${g.usuario}

## Resumen

${m.resumen}

## Participantes

${participantes}

## Decisiones

${lista(m.decisiones, 'No se cerró ninguna decisión')}

## Compromisos

${compromisos}

## Preguntas abiertas

${lista(m.preguntasAbiertas, 'Ninguna')}

## Riesgos

${lista(m.riesgos, 'Ninguno mencionado')}

## Temas

${lista(m.temas, 'Sin clasificar')}
`
}

/**
 * La misma minuta en HTML. Drive convierte HTML a documento de Google al subir,
 * y asi queda editable y comentable en vez de ser un texto plano muerto.
 */
export function aHtml(m: Minuta, g: Grabacion): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const ul = (items: string[], vacio: string) =>
    items.length
      ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : `<p><i>${vacio}</i></p>`

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(m.titulo)}</title></head><body>
<h1>${esc(m.titulo)}</h1>
<p><b>Fecha:</b> ${g.creadaEn.slice(0, 10)}<br><b>Duración:</b> ${reloj(g.duracionSeg)}<br><b>Grabó:</b> ${esc(g.usuario)}</p>
<h2>Resumen</h2><p>${esc(m.resumen)}</p>
<h2>Participantes</h2>${ul(
    m.participantes.map(
      (p) => `${p.nombre}${p.rol ? ` (${p.rol})` : ''}${p.origen === 'dicho' ? ' — sin confirmar' : ''}`,
    ),
    'Sin participantes identificados',
  )}
<h2>Decisiones</h2>${ul(m.decisiones, 'No se cerró ninguna decisión')}
<h2>Compromisos</h2>${ul(
    m.compromisos.map(
      (c) => `${c.que} — ${c.duenio ?? 'sin dueño'}${c.plazo ? `, para el ${c.plazo}` : ', sin plazo'}`,
    ),
    'Nadie se llevó trabajo',
  )}
<h2>Preguntas abiertas</h2>${ul(m.preguntasAbiertas, 'Ninguna')}
<h2>Riesgos</h2>${ul(m.riesgos, 'Ninguno mencionado')}
<h2>Temas</h2>${ul(m.temas, 'Sin clasificar')}
</body></html>`
}

/** Nombre de la carpeta de la reunion: ordena solo por fecha en Drive. */
export function nombreCarpeta(g: Grabacion, titulo: string): string {
  const limpio = titulo.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${g.creadaEn.slice(0, 10)} — ${limpio || 'Reunión'}`
}
