/**
 * Google Chat manda los mensajes en dos formatos: el clásico de las apps de
 * Chat y el de complementos de Workspace, al que Google está migrando. Esto los
 * lleva a una sola forma, para que el resto del código no tenga que saber cuál
 * llegó y el Asistente no se rompa el día que cambie.
 */
function normalizarEvento(e) {
  e = e || {};
  if (e.chat) {
    const c = e.chat;
    const carga = c.messagePayload || c.appCommandPayload || c.addedToSpacePayload || c.removedFromSpacePayload || {};
    let tipo = 'OTRO';
    if (c.messagePayload) tipo = 'MESSAGE';
    else if (c.appCommandPayload) tipo = 'APP_COMMAND';
    else if (c.addedToSpacePayload) tipo = 'ADDED_TO_SPACE';
    else if (c.removedFromSpacePayload) tipo = 'REMOVED_FROM_SPACE';
    return { formato: 'complemento', tipo: tipo, usuario: c.user || {}, mensaje: carga.message || {}, espacio: carga.space || {} };
  }
  return { formato: 'clasico', tipo: e.type || 'MESSAGE', usuario: e.user || {}, mensaje: e.message || {}, espacio: e.space || {} };
}

/** La respuesta en el formato que espera quien preguntó. */
function contestar(evento, texto) {
  if (evento.formato === 'complemento') {
    return { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text: texto } } } } };
  }
  return { text: texto };
}

/** El texto sin la mención "@Asistente" que se agrega en los espacios grupales. */
function textoDelMensaje(mensaje) {
  return String(mensaje.argumentText || mensaje.text || '').trim();
}

/** El primer adjunto que sea audio (o video, del que se usa el audio). */
function adjuntoDeAudio(mensaje) {
  const adjuntos = mensaje.attachment || mensaje.attachments || [];
  for (let i = 0; i < adjuntos.length; i++) {
    const tipo = String(adjuntos[i].contentType || '');
    if (tipo.indexOf('audio/') === 0 || tipo.indexOf('video/') === 0) return adjuntos[i];
  }
  return null;
}

/** El id de un archivo de Drive pegado como enlace en el mensaje, si lo hay. */
function idDeDrive(texto) {
  const m = String(texto || '').match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]{20,})/);
  return m ? m[1] : null;
}

/**
 * Los teléfonos etiquetan el mismo formato de maneras distintas. Se lleva a la
 * forma que Gemini reconoce.
 */
function tipoParaGemini(tipo) {
  const t = String(tipo || '').toLowerCase().split(';')[0].trim();
  if (t === 'audio/x-m4a' || t === 'audio/m4a') return 'audio/mp4';
  if (t === 'audio/mpeg3' || t === 'audio/x-mpeg-3') return 'audio/mp3';
  return t || 'audio/mp4';
}
