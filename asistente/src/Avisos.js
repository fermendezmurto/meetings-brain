/**
 * Los correos del Asistente.
 *
 * Los que salen de una conversación en Chat se mandan con la cuenta de quien
 * escribió: si Fernando le pide algo a Diana, el correo le llega a Diana de
 * parte de Fernando, que es lo que pasó. Los que salen del procesamiento de
 * reuniones y del resumen de la mañana, con la cuenta de quien instaló.
 */

/**
 * Saca el negrito y la cursiva de Chat para un correo. Solo las marcas, no
 * cualquier asterisco o guion bajo: un enlace puede tener los dos.
 */
function sinFormatoChat_(texto) {
  return String(texto)
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2');
}

function avisarTarea_(t, origen) {
  const plazo = formatearPlazo(t.plazo, hoy_());
  MailApp.sendEmail({
    to: t.emailResponsable,
    subject: 'Tarea #' + t.numero + ': ' + t.que,
    name: origen.pidio + ' (vía Asistente)',
    body: [
      origen.pidio + ' te anotó una tarea.',
      '',
      t.que,
      plazo ? 'Para: ' + plazo : 'Sin fecha.',
      origen.enlace ? '\nSale de la minuta: ' + origen.enlace : '',
      '',
      'Cuando esté hecha, escribile "listo ' + t.numero + '" al Asistente en Google Chat.',
      'Para ver todo lo tuyo, escribile "pendientes".',
    ].join('\n'),
  });
}

function avisarCierre_(t, quien) {
  MailApp.sendEmail({
    to: t.emailPidio,
    subject: 'Hecha: #' + t.numero + ' ' + t.que,
    name: quien.nombre + ' (vía Asistente)',
    body: quien.nombre + ' cerró la tarea que le pediste:\n\n#' + t.numero + ' ' + t.que,
  });
}

function avisarMinuta_(r, m, url, anotadas) {
  const hoy = hoy_();
  const tareas = anotadas.map(function (a) {
    return '- ' + sinFormatoChat_(lineaTarea(a.tarea, hoy, true)) + (a.problema ? '\n  ' + a.problema : '');
  });
  MailApp.sendEmail({
    to: r.email,
    subject: 'Minuta: ' + (m.titulo || 'Reunión'),
    name: 'Asistente',
    body: [
      'Ya está la minuta de la reunión que grabaste.',
      '',
      m.resumen || '',
      '',
      'Documento completo: ' + url,
      'La transcripción literal se agrega al mismo documento en la próxima media hora.',
      '',
      tareas.length ? 'Tareas repartidas:\n' + tareas.join('\n') : 'No surgieron tareas con responsable.',
      '',
      'Cada responsable recibió la suya por correo.',
    ].join('\n'),
  });
}

function avisarFalla_(r) {
  MailApp.sendEmail({
    to: r.email,
    subject: 'No pude procesar la reunión del ' + r.recibida.slice(0, 10),
    name: 'Asistente',
    body: [
      'Intenté ' + r.intentos + ' veces procesar la reunión que me mandaste y no pude.',
      '',
      'Motivo: ' + r.error,
      '',
      'El audio quedó guardado, no se perdió: https://drive.google.com/drive/folders/' + r.carpetaId,
    ].join('\n'),
  });
}

/**
 * Cada mañana hábil, a cada persona con tareas abiertas, su lista. Es lo que
 * hace que las tareas no se olviden sin que nadie tenga que acordarse de
 * preguntar.
 */
function avisoMatutino() {
  const hoy = hoy_();
  const dia = diaDeLaSemana(hoy);
  if (dia === 0 || dia === 6) return;

  // Corre con la cuenta de quien instaló: es su oportunidad de sincronizar.
  sincronizarGoogleTasks_(usuarioActual_());

  const porPersona = {};
  tareas_().forEach(function (t) {
    if (t.estado !== 'abierta' || !t.emailResponsable || yaOcurrio(t, hoy)) return;
    (porPersona[t.emailResponsable] = porPersona[t.emailResponsable] || []).push(t);
  });

  Object.keys(porPersona).forEach(function (email) {
    const suyas = porPersona[email];
    const vencidas = suyas.filter(function (t) { return esFechaIso(t.plazo) && t.plazo < hoy; }).length;
    MailApp.sendEmail({
      to: email,
      subject: 'Tus pendientes de hoy' + (vencidas ? ' (' + vencidas + ' vencida' + (vencidas > 1 ? 's' : '') + ')' : ''),
      name: 'Asistente',
      body: sinFormatoChat_(listarPendientes(suyas, hoy)),
    });
  });
}

/** La confirmación de una nota que se terminó de procesar fuera de Chat. */
function avisarNotaProcesada_(m, respuesta) {
  MailApp.sendEmail({
    to: m.email,
    subject: 'Listo: ' + resumenDeNota_(m),
    name: 'Asistente',
    body: [
      'Gemini estaba lento cuando me escribiste (' + m.recibido.slice(11) + '). Ya quedó:',
      '',
      sinFormatoChat_(respuesta),
    ].join('\n'),
  });
}

function avisarNotaNoProcesada_(m) {
  MailApp.sendEmail({
    to: m.email,
    subject: 'No pude anotar: ' + resumenDeNota_(m),
    name: 'Asistente',
    body: [
      'Intenté ' + m.intentos + ' veces entender lo que me mandaste a las ' + m.recibido.slice(11) + ' y no pude.',
      '',
      'Motivo: ' + m.error,
      '',
      m.texto ? 'Lo que escribiste: "' + m.texto + '"' : 'Era una nota de voz.',
      'Mandámelo de nuevo en un rato.',
    ].join('\n'),
  });
}

function resumenDeNota_(m) {
  if (!m.texto) return 'tu nota de voz de las ' + m.recibido.slice(11);
  return m.texto.length > 60 ? m.texto.slice(0, 57) + '…' : m.texto;
}
