import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * Carga archivos del Asistente como los carga Apps Script: todos en el mismo
 * espacio global, sin import ni export. Solo sirve para los archivos puros; los
 * que tocan SpreadsheetApp o UrlFetchApp no se prueban aca.
 */
export function cargar(...archivos: string[]): Record<string, any> {
  const contexto = vm.createContext({})
  const codigo = archivos
    .map((a) => readFileSync(path.join(__dirname, '../../asistente/src', a), 'utf8'))
    .join('\n')
  // Las const de nivel superior no quedan como propiedades del contexto; se
  // exponen a mano los nombres que las pruebas necesitan.
  vm.runInContext(
    `${codigo}
     this.__exp = { configRazonamiento, mensajeModeloRetirado, esErrorPasajero, convieneReintentar, normalizarNombre, buscarPersona, formatearPlazo, fechaParaElModelo,
       esFechaIso, interpretarComando,
       ${archivos.includes('Prompts.js') ? 'promptNota, promptMinuta, promptTramo, marcaDeTiempo, minutosDeAudio, ESQUEMA_NOTA, ESQUEMA_MINUTA, ESQUEMA_TRAMO,' : ''}
       ${archivos.includes('Formato.js') ? 'listarPendientes, listarPedidos, confirmarAnotadas, lineaTarea, reloj, renderizarTurnos, seccionesMinuta, textoBienvenida,' : ''}
     }`,
    contexto,
  )
  return (contexto as any).__exp
}

export const TODOS = ['Modelos.js', 'Texto.js', 'Fechas.js', 'Intencion.js', 'Prompts.js', 'Formato.js']
