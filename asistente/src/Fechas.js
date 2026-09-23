/**
 * Fechas de vencimiento, dichas como se dicen en la oficina: "hoy", "mañana",
 * "vie 26/09". Trabaja con fechas AAAA-MM-DD sin hora, asi la zona horaria no
 * mueve un vencimiento de dia.
 */

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function esFechaIso(texto) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(texto || ''));
}

function diaDeLaSemana(fechaIso) {
  const p = fechaIso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

function diasEntre(desdeIso, hastaIso) {
  const a = desdeIso.split('-').map(Number);
  const b = hastaIso.split('-').map(Number);
  return Math.round(
    (Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000
  );
}

function fechaCorta(fechaIso) {
  const p = fechaIso.split('-');
  return DIAS_CORTOS[diaDeLaSemana(fechaIso)] + ' ' + p[2] + '/' + p[1];
}

/**
 * @return {string} '' si no hay plazo; 'hoy', 'mañana', 'vie 26/09', o
 *   'vencida: lun 22/09' cuando ya paso.
 */
function formatearPlazo(plazoIso, hoyIso) {
  if (!esFechaIso(plazoIso)) return '';
  const faltan = diasEntre(hoyIso, plazoIso);
  if (faltan < 0) return 'vencida: ' + fechaCorta(plazoIso);
  if (faltan === 0) return 'hoy';
  if (faltan === 1) return 'mañana';
  return fechaCorta(plazoIso);
}

/** "jueves 25/09/2026": lo que necesita el modelo para resolver "el viernes". */
function fechaParaElModelo(hoyIso) {
  const p = hoyIso.split('-');
  return DIAS_LARGOS[diaDeLaSemana(hoyIso)] + ' ' + p[2] + '/' + p[1] + '/' + p[0];
}

/** "mañana 17:00", "vie 26/09", "hoy". La hora se agrega si la hay. */
function formatearCuando(plazoIso, hora, hoyIso) {
  const dia = formatearPlazo(plazoIso, hoyIso);
  if (!dia) return '';
  return esHora(hora) ? dia + ' ' + normalizarHora(hora) : dia;
}
