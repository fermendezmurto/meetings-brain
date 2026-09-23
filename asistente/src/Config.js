/**
 * Configuración. Lo que cambia entre instalaciones vive en las Propiedades del
 * script (Configuración del proyecto → Propiedades del script), no en el código:
 * así la clave de Gemini nunca queda escrita en un archivo.
 *
 *   GEMINI_API_KEY   obligatoria. La clave de aistudio.google.com.
 *   GEMINI_MODEL     opcional. Por defecto gemini-3.6-flash. Si Google retira un
 *                    modelo, el error dice cuál poner acá.
 *   GEMINI_MODEL_NOTAS  el modelo liviano que atiende Chat. Lo elige instalar()
 *                    entre los que Google ofrece a la clave.
 *   GEMINI_MODEL_RESPALDO opcional. El que se prueba cuando el de las reuniones
 *                    está saturado. Por defecto, el de notas; "ninguno" lo apaga.
 *   CARPETA_ID       la completa instalar().
 *   BASE_ID          la completa instalar().
 */

const ZONA = 'America/Asuncion';
const MODELO_POR_DEFECTO = 'gemini-3.6-flash';
/**
 * La variante liviana: más rápida, más barata y la que menos se satura. Es la
 * que atiende Chat, donde alguien espera la respuesta. Si instalar() no pudo
 * consultar la lista de Google, se usa esta.
 */
const LIVIANO_POR_DEFECTO = 'gemini-3.5-flash-lite';

/** Modelos para cada uso: el primero que se intenta y el de respaldo. */
function modelosPara_(uso) {
  const grande = prop_('GEMINI_MODEL', MODELO_POR_DEFECTO);
  const liviano = prop_('GEMINI_MODEL_NOTAS', LIVIANO_POR_DEFECTO);
  if (uso === 'nota') {
    return { principal: liviano, propiedad: 'GEMINI_MODEL_NOTAS', respaldo: modeloDeRespaldo(liviano, grande) };
  }
  return {
    principal: grande,
    propiedad: 'GEMINI_MODEL',
    respaldo: modeloDeRespaldo(grande, prop_('GEMINI_MODEL_RESPALDO', liviano)),
  };
}

/**
 * Hasta este tamaño un audio es una nota de voz y se contesta en el momento.
 * Más grande es una reunión y se procesa aparte: Chat corta la espera a los
 * 30 segundos y una reunión tarda más que eso.
 */
const LIMITE_NOTA_BYTES = 2.5 * 1024 * 1024;

/**
 * Apps Script no manda más de 50 MB por pedido. Con margen, 48 MB son entre 50
 * minutos y hora y media de grabación del teléfono, según la calidad.
 */
const LIMITE_AUDIO_BYTES = 48 * 1024 * 1024;

function prop_(clave, porDefecto) {
  const valor = PropertiesService.getScriptProperties().getProperty(clave);
  return valor ? String(valor).trim() : (porDefecto === undefined ? '' : porDefecto);
}

function exigirProp_(clave) {
  const valor = prop_(clave);
  if (!valor) {
    throw new Error('Falta ' + clave + ' en las Propiedades del script. ¿Corriste instalar()?');
  }
  return valor;
}

function hoy_() {
  return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
}

function ahora_() {
  return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd HH:mm');
}
