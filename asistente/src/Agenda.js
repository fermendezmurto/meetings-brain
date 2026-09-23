/**
 * Qué va al calendario y qué va a Google Tasks. Sin dependencias de Google,
 * para poder probarlo afuera.
 *
 * Un evento ocurre en un momento: una reunión, una llamada, algo con hora. Una
 * tarea es algo que alguien tiene que hacer para una fecha. La diferencia
 * importa porque cada una va a donde la persona la va a mirar: los eventos al
 * calendario, las tareas a su lista.
 */

/** "17:00", "9:30". */
function esHora(texto) {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(texto || ''));
}

/** Siempre con dos dígitos: "9:30" pasa a "09:30". */
function normalizarHora(texto) {
  if (!esHora(texto)) return '';
  const p = String(texto).split(':');
  return (p[0].length === 1 ? '0' : '') + p[0] + ':' + p[1];
}

/**
 * Sin fecha no hay dónde poner un evento en el calendario: queda como tarea.
 * Con fecha, es evento si el modelo dijo que lo es o si se dijo una hora
 * ("recordame llamar al banco el lunes a las 10" es un momento, no un plazo).
 */
function clasificarItem(item) {
  if (!esFechaIso(item.plazo)) return 'tarea';
  if (item.tipo === 'evento' || esHora(item.hora)) return 'evento';
  return 'tarea';
}

/** Un evento cuyo día ya pasó no está pendiente: ya ocurrió. */
function yaOcurrio(t, hoy) {
  return t.tipo === 'evento' && esFechaIso(t.plazo) && t.plazo < hoy;
}

/**
 * Qué hay que hacer para que la base y el Google Tasks de una persona digan lo
 * mismo. Se decide acá y se ejecuta afuera, así la regla se puede probar.
 *
 * @param {Object[]} suyas   tareas de la base de las que la persona es responsable
 * @param {Object}   enTasks estado en su Google Tasks, por id: 'needsAction' | 'completed'
 * @return {{crear: Object[], cerrarEnBase: Object[], completarEnTasks: Object[]}}
 */
function planDeSincronizacion(suyas, enTasks) {
  const plan = { crear: [], cerrarEnBase: [], completarEnTasks: [] };
  suyas.forEach(function (t) {
    if (t.tipo === 'evento') return;
    const estado = t.idTasks ? enTasks[t.idTasks] : undefined;
    if (t.estado === 'abierta') {
      // Si la persona la borró de su lista, no se vuelve a crear: sería
      // insistirle con algo que sacó a propósito. Sigue en la base y en el
      // resumen de la mañana.
      if (!t.idTasks) plan.crear.push(t);
      else if (estado === 'completed') plan.cerrarEnBase.push(t);
    } else if (t.idTasks && estado === 'needsAction') {
      plan.completarEnTasks.push(t);
    }
  });
  return plan;
}

/** Paraguay está en UTC-3 todo el año desde 2024. */
const DESFASE_UTC_HORAS = 3;

function dos_(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * Un enlace que agrega el evento al calendario de quien lo abre, con un clic.
 * Es la forma de poner algo en el calendario de otra persona sin tener permiso
 * sobre su cuenta: el Asistente lo manda por correo cuando no pudo agendarlo él.
 */
function enlaceCalendario(t, duracionMinutos) {
  const p = t.plazo.split('-').map(Number);
  let fechas;
  if (esHora(t.hora)) {
    const h = normalizarHora(t.hora).split(':').map(Number);
    const inicio = new Date(Date.UTC(p[0], p[1] - 1, p[2], h[0] + DESFASE_UTC_HORAS, h[1]));
    const fin = new Date(inicio.getTime() + (Number(duracionMinutos) || 60) * 60000);
    const utc = function (d) {
      return d.getUTCFullYear() + dos_(d.getUTCMonth() + 1) + dos_(d.getUTCDate()) + 'T' +
        dos_(d.getUTCHours()) + dos_(d.getUTCMinutes()) + '00Z';
    };
    fechas = utc(inicio) + '/' + utc(fin);
  } else {
    const siguiente = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
    fechas = t.plazo.replace(/-/g, '') + '/' + siguiente.getUTCFullYear() +
      dos_(siguiente.getUTCMonth() + 1) + dos_(siguiente.getUTCDate());
  }
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(t.que) +
    '&dates=' + fechas +
    '&details=' + encodeURIComponent('Anotado por el Asistente (#' + t.numero + ').');
}

/**
 * Cuánto se espera a que termine un mensaje que se estaba atendiendo en Chat.
 * Google corta esas ejecuciones pasados unos 30 segundos; si a los dos minutos
 * sigue "procesando", la ejecución murió y hay que retomarlo.
 */
const ABANDONO_MS = 2 * 60 * 1000;

/** Si la tarea automática tiene que ocuparse de este mensaje de la bandeja. */
function hayQueRetomar(m, ahoraMs) {
  if (m.estado === 'pendiente') return true;
  return m.estado === 'procesando' && ahoraMs - m.recibidoMs > ABANDONO_MS;
}
