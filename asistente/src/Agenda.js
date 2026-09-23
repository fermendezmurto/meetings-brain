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
