/**
 * Lo que el Asistente escribe en Chat. Corto, sin adornos, y siempre con el
 * numero de cada tarea, que es lo que la gente usa para cerrarla ("listo 12").
 *
 * En Google Chat el negrito va entre asteriscos simples.
 */

function textoAyuda() {
  return [
    '*Qué podés hacer conmigo*',
    '',
    '• *Anotar algo:* escribime o mandame un audio. "Pedile a Diana el presupuesto para el viernes", "recordame llamar al estudio mañana".',
    '• *Una reunión:* grabala con la grabadora del teléfono y mandame el audio. Si querés, escribí con quién era. Te aviso cuando esté la minuta.',
    '• *pendientes:* lo que tenés que hacer vos.',
    '• *pedidos:* lo que les pediste a otros.',
    '• *listo 12:* cierra la tarea 12.',
  ].join('\n');
}

function textoBienvenida(nombre) {
  return [
    'Hola, ' + nombre + '. Soy el Asistente: anoto tareas, reparto pedidos y armo las minutas de las reuniones.',
    '',
    textoAyuda(),
    '',
    '_Estamos en piloto: no me mandes todavía nada confidencial._',
  ].join('\n');
}

/** Una tarea en una línea: "#12 Enviar el presupuesto — Diana · vie 26/09". */
function lineaTarea(t, hoy, mostrarResponsable) {
  const plazo = formatearPlazo(t.plazo, hoy);
  let linea = '*#' + t.numero + '* ' + t.que;
  if (mostrarResponsable) linea += ' — ' + (t.responsable || 'sin responsable');
  if (plazo) linea += ' · ' + (plazo.indexOf('vencida') === 0 ? '*' + plazo + '*' : plazo);
  return linea;
}

/**
 * Las vencidas y las de fecha más cercana arriba; las sin fecha al final.
 * Es el orden en que alguien las tiene que mirar.
 */
function ordenarPorPlazo(tareas) {
  return tareas.slice().sort(function (a, b) {
    const pa = esFechaIso(a.plazo) ? a.plazo : '9999-99-99';
    const pb = esFechaIso(b.plazo) ? b.plazo : '9999-99-99';
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.numero - b.numero;
  });
}

function listarPendientes(tareas, hoy) {
  if (!tareas.length) return 'No tenés nada pendiente.';
  return ['*Tus pendientes*', '']
    .concat(ordenarPorPlazo(tareas).map(function (t) { return '• ' + lineaTarea(t, hoy, false); }))
    .concat(['', 'Cuando termines una, escribime *listo* y el número.'])
    .join('\n');
}

function listarPedidos(tareas, hoy) {
  if (!tareas.length) return 'No tenés pedidos abiertos a otras personas.';
  return ['*Lo que pediste y sigue abierto*', '']
    .concat(ordenarPorPlazo(tareas).map(function (t) { return '• ' + lineaTarea(t, hoy, true); }))
    .join('\n');
}

/**
 * La confirmación después de anotar. Dice explícitamente a quién no se le pudo
 * avisar y por qué: una tarea que el responsable no se enteró que tiene es una
 * tarea que no existe.
 */
function confirmarAnotadas(respuesta, anotadas, hoy) {
  const lineas = [respuesta, ''];
  anotadas.forEach(function (a) {
    lineas.push('• ' + lineaTarea(a.tarea, hoy, true));
    if (a.problema) lineas.push('   ' + a.problema);
  });
  return lineas.join('\n').trim();
}

function reloj(segundos) {
  const s = Math.max(0, Math.round(Number(segundos) || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const dos = function (n) { return (n < 10 ? '0' : '') + n; };
  return hh > 0 ? hh + ':' + dos(mm) + ':' + dos(ss) : dos(mm) + ':' + dos(ss);
}

/** Turnos de la transcripción en texto, con minuto y nombre. */
function renderizarTurnos(turnos) {
  return (turnos || []).map(function (t) {
    return '[' + reloj(t.desde) + '] ' + (t.quien || 'Sin identificar') + ': ' + t.texto;
  }).join('\n');
}

/**
 * Las secciones de la minuta en orden. La usan el documento de Drive y el
 * correo, para que digan exactamente lo mismo.
 */
function seccionesMinuta(m) {
  return [
    { titulo: 'Participantes', items: (m.participantes || []).map(function (p) { return p.nombre + (p.rol ? ' (' + p.rol + ')' : ''); }), vacio: 'Sin identificar' },
    { titulo: 'Decisiones', items: m.decisiones || [], vacio: 'No se cerró ninguna decisión' },
    {
      titulo: 'Compromisos',
      items: (m.compromisos || []).map(function (c) {
        return c.que + ' — ' + (c.responsable || 'sin responsable') + (esFechaIso(c.plazo) ? ', para el ' + fechaCorta(c.plazo) : ', sin plazo');
      }),
      vacio: 'Nadie se llevó trabajo',
    },
    { titulo: 'Preguntas abiertas', items: m.preguntasAbiertas || [], vacio: 'Ninguna' },
    { titulo: 'Riesgos', items: m.riesgos || [], vacio: 'Ninguno mencionado' },
  ];
}
