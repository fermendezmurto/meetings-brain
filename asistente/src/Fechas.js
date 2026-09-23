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

/** 'AAAA-MM-DD' si el día existe, o '' ("31/02" no es una fecha). */
function fechaValida_(anio, mes, dia) {
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return '';
  const dos = function (n) { return (n < 10 ? '0' : '') + n; };
  return anio + '-' + dos(mes) + '-' + dos(dia);
}

/**
 * Lleva una fecha a AAAA-MM-DD aunque el modelo la devuelva en otro formato.
 * En el piloto, "mandar la propuesta el viernes" quedó sin fecha: el modelo
 * contestó bien pero no con la forma pedida, y la fecha se descartó.
 *
 * Acepta 2026-09-25, 2026-09-25T00:00:00, 25/09/2026, 25/09/26 y 25/09. Sin año,
 * una fecha que ya pasó es del año siguiente: "15/01" dicho en diciembre.
 */
function normalizarFecha(texto, hoyIso) {
  const t = String(texto || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fechaValida_(Number(m[1]), Number(m[2]), Number(m[3]));

  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (!m) return '';
  let anio = m[3] ? Number(m[3]) : Number(hoyIso.slice(0, 4));
  if (anio < 100) anio += 2000;
  const fecha = fechaValida_(anio, Number(m[2]), Number(m[1]));
  if (fecha && !m[3] && fecha < hoyIso) return fechaValida_(anio + 1, Number(m[2]), Number(m[1]));
  return fecha;
}
