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
 * Cuánto tiene que quedar para que valga la pena otro intento: lo que tarda
 * Gemini en contestar una nota, más anotarla y agendarla, antes de que Chat
 * deje de esperar.
 */
const MARGEN_REINTENTO_MS = 10000;

/**
 * Cuántos pedidos como máximo. En el nivel gratuito la saturación es
 * intermitente: en la prueba real un pedido pasó y el siguiente no, así que
 * insistir unas veces alternando modelos rinde. Sin corte de tiempo, como en
 * las reuniones, se insiste menos: la próxima corrida vuelve a intentar.
 */
const MAX_PEDIDOS_CON_CORTE = 6;
const MAX_PEDIDOS_SIN_CORTE = 4;

/**
 * El modelo del intento número n (desde 0): se alternan los disponibles. Da
 * más chances que insistir con uno solo, porque cada uno tiene su capacidad.
 */
function modeloDelIntento(modelos, n) {
  return modelos[n % modelos.length];
}

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

/**
 * Si el modelo más rápido viene tardando más que esto, no se lo intenta dentro
 * de Chat: con lo que se va en leer y anotar, no llegaría a los 30 segundos.
 */
const ESPERA_MAXIMA_EN_CHAT_MS = 12000;

/**
 * Cuánto se supone que tarda un modelo del que todavía no hay mediciones.
 * Lo bastante bajo como para darle una oportunidad en Chat.
 */
const ESPERA_SIN_DATOS_MS = 8000;

/** Un modelo que falló hace menos de esto va al final de la fila. */
const PENALIDAD_FALLA_MS = 5 * 60 * 1000;

/** Las mediciones viejas no dicen nada del momento: se descartan. */
const VIGENCIA_MEDICION_MS = 30 * 60 * 1000;

/**
 * Lo que se espera que tarde un modelo según lo medido, o Infinity si viene
 * fallando. En la primera prueba real el modelo "rápido" tardó 37 segundos y
 * el otro 7: suponer cuál es más rápido salió mal, medir no.
 *
 * @param {Object} medicion {ms, fallaEn, en} o undefined
 */
function esperaEstimada(medicion, ahoraMs) {
  if (!medicion || ahoraMs - medicion.en > VIGENCIA_MEDICION_MS) return ESPERA_SIN_DATOS_MS;
  if (medicion.fallaEn && ahoraMs - medicion.fallaEn < PENALIDAD_FALLA_MS) return Infinity;
  return medicion.ms || ESPERA_SIN_DATOS_MS;
}

/**
 * Los modelos en el orden en que conviene probarlos: el más rápido según lo
 * medido primero. Con empate, se respeta el orden de preferencia.
 */
function ordenarPorDesempeno(modelos, mediciones, ahoraMs) {
  return modelos
    .map(function (m, i) { return { m: m, i: i, e: esperaEstimada(mediciones[m], ahoraMs) }; })
    .sort(function (a, b) { return a.e === b.e ? a.i - b.i : a.e - b.e; })
    .map(function (x) { return x.m; });
}

/**
 * Suma una medición. El promedio pesa lo último a la mitad: la saturación cambia
 * rápido y lo que pasó hace una hora importa poco.
 */
function registrarMedicion(mediciones, modelo, ms, ok, ahoraMs) {
  const previa = mediciones[modelo];
  const vigente = previa && ahoraMs - previa.en <= VIGENCIA_MEDICION_MS;
  const nueva = { en: ahoraMs, ms: vigente ? previa.ms : 0, fallaEn: vigente ? previa.fallaEn || 0 : 0 };
  if (ok) {
    nueva.ms = nueva.ms ? Math.round((nueva.ms + ms) / 2) : ms;
    nueva.fallaEn = 0;
  } else {
    nueva.fallaEn = ahoraMs;
  }
  mediciones[modelo] = nueva;
  return mediciones;
}
