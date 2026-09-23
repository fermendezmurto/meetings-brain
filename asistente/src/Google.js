/**
 * Calendar y Google Tasks.
 *
 * Todo corre con la cuenta de quien está usando el Asistente en ese momento:
 * su calendario y su lista de tareas. Google no deja escribir en la lista de
 * otra persona sin un permiso del administrador; por eso una tarea para Diana
 * aparece en su Google Tasks la próxima vez que ella le escribe al Asistente,
 * que es cuando el Asistente corre con la cuenta de ella.
 */

function usuarioActual_() {
  return String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
}

/**
 * El evento va al calendario de quien lo pidió, con invitación a los demás:
 * la invitación es la forma en que Google pone un evento en el calendario de
 * otra persona sin permisos especiales.
 */
function crearEvento_(t, invitados, duracionMinutos) {
  const opciones = {
    description: 'Anotado por el Asistente (#' + t.numero + '), a pedido de ' + t.pidio + '.' +
      (t.enlace ? '\n' + t.enlace : ''),
  };
  if (invitados.length) {
    opciones.guests = invitados.join(',');
    opciones.sendInvites = true;
  }
  const calendario = CalendarApp.getDefaultCalendar();
  let evento;
  if (esHora(t.hora)) {
    const inicio = Utilities.parseDate(t.plazo + ' ' + normalizarHora(t.hora), ZONA, 'yyyy-MM-dd HH:mm');
    const fin = new Date(inicio.getTime() + (Number(duracionMinutos) || 60) * 60000);
    evento = calendario.createEvent(t.que, inicio, fin, opciones);
  } else {
    evento = calendario.createAllDayEvent(t.que, Utilities.parseDate(t.plazo, ZONA, 'yyyy-MM-dd'), opciones);
  }
  return evento.getId();
}

function crearGoogleTask_(t) {
  const tarea = {
    title: t.que,
    notes: 'Tarea #' + t.numero + ' del Asistente, pedida por ' + t.pidio + '.' +
      (t.enlace ? '\n' + t.enlace : '') +
      '\nMarcarla como hecha acá la cierra también en el Asistente.',
  };
  // Google Tasks guarda solo el día: la hora de la fecha se ignora.
  if (esFechaIso(t.plazo)) tarea.due = t.plazo + 'T00:00:00.000Z';
  return Tasks.Tasks.insert(tarea, '@default').id;
}

/** Estado de cada tarea de la lista de la persona, por id. */
function estadoEnTasks_() {
  const estado = {};
  let pagina;
  do {
    const r = Tasks.Tasks.list('@default', {
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
      pageToken: pagina,
    });
    (r.items || []).forEach(function (x) { estado[x.id] = x.status; });
    pagina = r.nextPageToken;
  } while (pagina);
  return estado;
}

function completarEnTasks_(id) {
  Tasks.Tasks.patch({ status: 'completed' }, '@default', id);
}

/**
 * Deja la base y el Google Tasks de la persona diciendo lo mismo, en los dos
 * sentidos: crea en su lista lo que tiene pendiente, marca como hecho allá lo
 * que se cerró por Chat, y cierra en la base lo que marcó como hecho allá.
 *
 * Lo último obliga a leer su lista entera, y eso cuesta tiempo. Por eso se hace
 * como mucho cada diez minutos, salvo que la persona pida sus pendientes, que
 * es cuando la lista tiene que estar al día. Lo demás se sabe mirando la base.
 *
 * Nunca rompe: si Google Tasks falla, el Asistente sigue funcionando y se
 * vuelve a intentar en la próxima conversación.
 */
function sincronizarGoogleTasks_(email, forzar) {
  try {
    const suyas = tareasDeResponsable_(email).filter(function (t) { return t.tipo !== 'evento'; });

    suyas.filter(function (t) { return t.estado === 'abierta' && !t.idTasks; }).forEach(function (t) {
      actualizarTarea_(t, { idTasks: crearGoogleTask_(t) });
    });
    suyas.filter(function (t) { return t.estado !== 'abierta' && t.idTasks && !t.cerradaEnTasks; }).forEach(function (t) {
      completarEnTasks_(t.idTasks);
      actualizarTarea_(t, { cerradaEnTasks: 'sí' });
    });

    const abiertasEnTasks = suyas.filter(function (t) { return t.estado === 'abierta' && t.idTasks; });
    if (!abiertasEnTasks.length) return;
    const cache = CacheService.getUserCache();
    if (!forzar && cache.get('tasks-al-dia')) return;

    const plan = planDeSincronizacion(abiertasEnTasks, estadoEnTasks_());
    plan.cerrarEnBase.forEach(function (t) {
      actualizarTarea_(t, { estado: 'cerrada', cerrada: ahora_(), cerradaEnTasks: 'sí' });
      if (t.emailPidio && t.emailPidio !== email) avisarCierre_(t, { nombre: t.responsable });
    });
    cache.put('tasks-al-dia', '1', 600);
  } catch (err) {
    console.error('Sincronización con Google Tasks de ' + email + ': ' + (err && err.stack ? err.stack : err));
  }
}
