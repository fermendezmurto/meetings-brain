/**
 * Reglas sobre los modelos de Gemini que no dependen de Google Apps Script, para
 * poder probarlas afuera.
 */

/**
 * Cuánto se deja "pensar" al modelo antes de contestar. Importa porque Apps
 * Script corta cada pedido a los 60 segundos y Chat espera 30: un razonamiento
 * sin tope puede gastarse ese tiempo solo.
 *
 * Cada familia lo regula distinto. La 2.5 Flash acepta un presupuesto en
 * unidades; la 3 en adelante, un nivel. A un modelo que no se conoce no se le
 * manda nada, para no provocar un error.
 *
 * @param {number|undefined} presupuesto 0 para tareas mecánicas como
 *   transcribir; más para lo que requiere criterio, como una minuta.
 */
function configRazonamiento(modelo, presupuesto) {
  if (presupuesto === undefined || presupuesto === null) return null;
  if (/^gemini-2\.5-flash/.test(modelo)) return { thinkingBudget: presupuesto };
  if (/^gemini-([3-9]|\d{2,})/.test(modelo)) return { thinkingLevel: 'low' };
  return null;
}

/**
 * Google retira modelos cada tanto, y cuando lo hace el error dice cuál usar.
 * Se traduce a qué tocar, para que no haga falta cambiar código.
 */
function mensajeModeloRetirado(modelo, cuerpo) {
  const sugerido = (String(cuerpo).match(/use (?:models\/)?(gemini-[\w.-]*[\w])/i) || [])[1];
  return 'Google retiró el modelo ' + modelo + '. ' + (sugerido
    ? 'En Propiedades del script, poné GEMINI_MODEL = ' + sugerido + ' y volvé a probar.'
    : 'En Propiedades del script, cambiá GEMINI_MODEL por un modelo vigente.');
}

/**
 * Errores de Gemini que se arreglan solos esperando: saturación del modelo y
 * fallas momentáneas del servidor. Con el nivel gratuito y un modelo recién
 * lanzado son frecuentes, y no tienen que tratarse como si algo estuviera roto.
 */
function esErrorPasajero(codigo) {
  return codigo === 500 || codigo === 502 || codigo === 503 || codigo === 504;
}

/**
 * Reintentar solo sirve si el fallo fue rápido. Si Gemini tardó en rechazar el
 * pedido, reintentar pasaría el límite de 30 segundos de Chat y el de 60 de
 * Apps Script, y la persona se quedaría sin ninguna respuesta.
 */
function convieneReintentar(codigo, milisegundos) {
  return esErrorPasajero(codigo) && milisegundos < 10000;
}

/**
 * El modelo a probar cuando el principal está saturado, o vacío si no hay.
 * No tiene sentido "respaldar" un modelo con él mismo.
 */
function modeloDeRespaldo(principal, configurado) {
  const r = String(configurado || '').trim();
  if (!r || r.toLowerCase() === 'ninguno' || r === principal) return '';
  return r;
}
