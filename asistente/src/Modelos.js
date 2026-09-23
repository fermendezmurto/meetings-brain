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
function mensajeModeloRetirado(modelo, cuerpo, propiedad) {
  propiedad = propiedad || 'GEMINI_MODEL';
  const sugerido = (String(cuerpo).match(/use (?:models\/)?(gemini-[\w.-]*[\w])/i) || [])[1];
  return 'Google retiró el modelo ' + modelo + '. ' + (sugerido
    ? 'En Propiedades del script, poné ' + propiedad + ' = ' + sugerido + ' y volvé a probar.'
    : 'En Propiedades del script, cambiá ' + propiedad + ' por un modelo vigente.');
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
 * Cuánto hace falta para que un segundo intento tenga chance de terminar. Una
 * nota con el modelo liviano suele contestar bastante antes.
 */
const MARGEN_REINTENTO_MS = 8000;

/**
 * Se reintenta si el error es pasajero y queda tiempo. Lo que importa no es
 * cuánto tardó el primer intento sino cuánto falta para el corte: en la primera
 * prueba real, Google tardó en decir "saturado" y una regla basada en la
 * demora del primer intento dejó afuera justo ese caso.
 *
 * @param {number|undefined} restanteMs hasta el corte; sin corte, siempre hay tiempo
 */
function convieneReintentar(codigo, restanteMs) {
  if (!esErrorPasajero(codigo)) return false;
  return restanteMs === undefined || restanteMs > MARGEN_REINTENTO_MS;
}

/**
 * De la lista de modelos que devuelve Google, el liviano más nuevo: el que
 * mejor aguanta la saturación y el que alcanza para entender una nota. Se
 * prefieren las versiones estables a las de prueba.
 */
function elegirModeloLiviano(nombres) {
  const candidatos = nombres
    .map(function (n) { return String(n).replace(/^models\//, ''); })
    .map(function (n) {
      const m = n.match(/^gemini-(\d+(?:\.\d+)?)-flash-lite(-preview)?$/);
      return m ? { nombre: n, version: Number(m[1]), estable: !m[2] } : null;
    })
    .filter(function (x) { return x; });
  if (!candidatos.length) return '';
  candidatos.sort(function (a, b) {
    if (a.estable !== b.estable) return a.estable ? -1 : 1;
    return b.version - a.version;
  });
  return candidatos[0].nombre;
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
