/**
 * Configuración. Lo que cambia entre instalaciones vive en las Propiedades del
 * script (Configuración del proyecto → Propiedades del script), no en el código:
 * así la clave de Gemini nunca queda escrita en un archivo.
 *
 *   GEMINI_API_KEY   obligatoria. La clave de aistudio.google.com.
 *   GEMINI_MODEL     opcional. Por defecto gemini-3.6-flash. Si Google retira un
 *                    modelo, el error dice cuál poner acá.
 *   CARPETA_ID       la completa instalar().
 *   BASE_ID          la completa instalar().
 */

const ZONA = 'America/Asuncion';
const MODELO_POR_DEFECTO = 'gemini-3.6-flash';

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
