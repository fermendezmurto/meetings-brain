/**
 * Procesa lo que quedó en la bandeja: los mensajes que no alcanzaron a
 * resolverse dentro de los 30 segundos de Chat, y los de ejecuciones que Google
 * cortó a la mitad. Corre cada minuto, con la cuenta de quien instaló.
 *
 * Cuando no hay nada pendiente, termina sin leer la planilla: la marca
 * BANDEJA_PENDIENTE la prende quien encola un mensaje y la apaga esto cuando
 * no queda nada.
 */

/**
 * Si Gemini sigue saturado, se insiste durante media hora, una vez por minuto,
 * antes de avisarle a la persona que no se pudo.
 */
const MAX_INTENTOS_BANDEJA = 30;

function procesarBandeja() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('BANDEJA_PENDIENTE')) return;
  if (!tomarTurno_('BANDEJA_HASTA')) return;
  try {
    const ahora = Date.now();
    bandeja_()
      .filter(function (m) { return hayQueRetomar(m, ahora); })
      .forEach(retomarMensaje_);

    const quedan = bandeja_().some(function (m) {
      return m.estado === 'pendiente' || m.estado === 'procesando';
    });
    if (!quedan) props.deleteProperty('BANDEJA_PENDIENTE');
  } finally {
    soltarTurno_('BANDEJA_HASTA');
  }
}

function retomarMensaje_(m) {
  // Si Chat alcanzó a anotarlo antes de que Google cortara la ejecución, no se
  // anota de nuevo: sería duplicar las tareas de la persona.
  if (tareasDelMensaje_(m.id).length) {
    actualizarMensaje_(m, { estado: 'lista', error: '' });
    return;
  }
  try {
    const respuesta = procesarMensaje_(m, { diferido: true });
    avisarNotaProcesada_(m, respuesta);
  } catch (err) {
    console.error('Mensaje ' + m.id + ': ' + (err && err.stack ? err.stack : err));
    const intentos = m.intentos + 1;
    const seRinde = !(err && err.pasajero) || intentos >= MAX_INTENTOS_BANDEJA;
    actualizarMensaje_(m, {
      intentos: intentos,
      error: mensajeDe_(err),
      estado: seRinde ? 'error' : 'pendiente',
    });
    if (seRinde) avisarNotaNoProcesada_(m);
  }
}
