// Junta los archivos del Asistente en uno solo, listo para pegar en Apps Script.
//
// Apps Script no tiene import ni export: todos los archivos comparten el mismo
// espacio global. Pegar uno solo en vez de trece es lo que hace que instalarlo
// no requiera saber programar.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'asistente')

export const ORDEN = [
  'Config.js', 'Modelos.js', 'Texto.js', 'Fechas.js', 'Agenda.js', 'Intencion.js', 'Eventos.js', 'Prompts.js',
  'Formato.js', 'Base.js', 'Gemini.js', 'Google.js', 'Avisos.js', 'Chat.js', 'Bandeja.js', 'Reuniones.js', 'Instalar.js',
]

export function armar() {
  const partes = ORDEN.map((f) => `// ===== ${f} =====\n\n${readFileSync(path.join(raiz, 'src', f), 'utf8').trim()}\n`)
  return [
    '/**',
    ' * Asistente de tareas y reuniones para Google Chat.',
    ' *',
    ' * ARCHIVO GENERADO: no se edita a mano. La fuente está en asistente/src y se',
    ' * vuelve a generar con: node scripts/armar-asistente.mjs',
    ' */',
    '',
    ...partes,
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(path.join(raiz, 'dist'), { recursive: true })
  writeFileSync(path.join(raiz, 'dist', 'Asistente.gs'), armar())
  copyFileSync(path.join(raiz, 'appsscript.json'), path.join(raiz, 'dist', 'appsscript.json'))
  console.log('asistente/dist/Asistente.gs listo')
}
