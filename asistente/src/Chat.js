/**
 * Lo que pasa cuando alguien le escribe al Asistente en Google Chat.
 *
 * Esto corre con la cuenta de quien escribe: cada persona lo autoriza una vez,
 * y a partir de ahí los correos que manda salen en su nombre y ve solo lo que
 * esa persona puede ver. Por eso no hace falta ningún permiso de administrador.
 *
 * Chat espera la respuesta como mucho 30 segundos. Todo lo que puede tardar más
 * (una reunión) se deja anotado y lo procesa procesarReuniones() aparte.
 */

/**
 * En la configuración de Chat, cada activador (mensaje, agregado a un espacio,
 * quitado, comando) apunta a una función. Esta los atiende a todos, por si se
 * configuró una sola función común.
 */
/** Cuándo empezó a atenderse el mensaje: Chat corta la espera a los 30 segundos. */
let INICIO_MENSAJE_ = 0;

function onMessage(e) {
  INICIO_MENSAJE_ = Date.now();
  const evento = normalizarEvento(e);
  if (evento.tipo === 'ADDED_TO_SPACE') return onAddedToSpace(e);
  if (evento.tipo === 'REMOVED_FROM_SPACE') return onRemovedFromSpace(e);
  try {
    return contestar(evento, responder_(evento));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    // Lo pasajero ya viene explicado y no es culpa de nadie de acá.
    if (err && err.pasajero) return contestar(evento, err.message);
    return contestar(evento, 'Algo falló de mi lado: ' + (err && err.message ? err.message : err) +
      '\nSi sigue pasando, avisale a quien me instaló.');
  }
}

function onAddedToSpace(e) {
  const evento = normalizarEvento(e);
  const quien = quienEscribe_(evento);
  try {
    registrarPersona_(quien.nombre, quien.email);
  } catch (err) {
    // Si todavía no está instalado, igual se saluda; el error aparece al usarlo.
    console.error(err);
  }
  if (evento.espacio.type === 'DM' || evento.espacio.spaceType === 'DIRECT_MESSAGE' || evento.espacio.singleUserBotDm) {
    return contestar(evento, textoBienvenida(nombreDePila_(quien.nombre)));
  }
  return contestar(evento, 'Gracias por sumarme. Mencioname con @Asistente para anotar algo o ver pendientes. Para cosas personales, escribime por privado.');
}

function onRemovedFromSpace() {
  // Nada que limpiar: las tareas quedan en la base aunque me saquen del espacio.
  // Tampoco hay a quién contestarle.
  return {};
}

function quienEscribe_(evento) {
  return {
    nombre: evento.usuario.displayName || evento.usuario.email || 'alguien',
    email: String(evento.usuario.email || '').toLowerCase(),
  };
}

function nombreDePila_(nombre) {
  return String(nombre || '').split(' ')[0];
}

function responder_(evento) {
  const quien = quienEscribe_(evento);
  if (!quien.email) return 'No pude saber quién sos. Escribime desde tu cuenta de la empresa.';
  registrarPersona_(quien.nombre, quien.email);
  // Es el momento en que el Asistente corre con la cuenta de esta persona: se
  // aprovecha para poner al día su Google Tasks con la base.
  sincronizarGoogleTasks_(quien.email);

  const texto = textoDelMensaje(evento.mensaje);
  const adjunto = adjuntoDeAudio(evento.mensaje);
  const idDrive = idDeDrive(texto);
  if (adjunto || idDrive) return recibirAudio_(quien, adjunto, idDrive, texto);

  const comando = interpretarComando(texto);
  const hoy = hoy_();
  switch (comando.tipo) {
    case 'vacio':
    case 'ayuda':
      return textoAyuda();
    case 'pendientes':
      return listarPendientes(pendientesDe_(quien.email), hoy);
    case 'pedidos':
      return listarPedidos(pedidosDe_(quien.email), hoy);
    case 'cerrar':
      return cerrar_(quien, comando.numero);
    default:
      return interpretarNota_(quien, { texto: comando.texto });
  }
}

// ---------- Audio ----------

/**
 * Un audio corto es una nota de voz: se entiende y se contesta en el momento.
 * Uno largo, o uno que diga "reunión", es una reunión: se guarda en Drive y se
 * procesa aparte, porque tarda más de lo que Chat está dispuesto a esperar.
 */
function recibirAudio_(quien, adjunto, idDrive, texto) {
  const audio = descargarAudio_(adjunto, idDrive);
  if (audio.tamanio > LIMITE_AUDIO_BYTES) {
    return 'El audio pesa ' + Math.round(audio.tamanio / 1048576) + ' MB y por ahora puedo con hasta ' +
      Math.round(LIMITE_AUDIO_BYTES / 1048576) + ' MB (alrededor de una hora). Si podés, partilo en dos y mandame cada parte.';
  }

  const esReunion = audio.tamanio > LIMITE_NOTA_BYTES || /reuni[oó]n|minuta/i.test(texto);
  if (!esReunion) {
    return interpretarNota_(quien, { audio: audio.blob, tipo: audio.tipo, texto: texto });
  }

  const id = Utilities.getUuid().slice(0, 8);
  const carpeta = carpetaDelMes_().createFolder(hoy_() + ' — ' + quien.nombre + ' — ' + id);
  const archivo = carpeta.createFile(audio.blob.setName('audio-' + id + extension_(audio.tipo)));
  encolarReunion_({
    id: id,
    titulo: '',
    grabo: quien.nombre,
    email: quien.email,
    nota: texto,
    carpetaId: carpeta.getId(),
    audioId: archivo.getId(),
    tipo: audio.tipo,
  });
  return 'Recibí la reunión (' + Math.round(audio.tamanio / 1048576 * 10) / 10 + ' MB). ' +
    'En unos minutos te llega la minuta por correo, y cada responsable recibe sus tareas.' +
    (texto ? '' : '\n\nLa próxima vez podés escribir con quién era al mandar el audio: ayuda a saber quién dijo qué.');
}

/**
 * Baja el audio de Chat o de Drive. El tamaño se toma del encabezado o de
 * Drive, nunca midiendo el contenido: medirlo obligaría a cargarlo entero.
 */
function descargarAudio_(adjunto, idDrive) {
  if (idDrive || (adjunto && adjunto.driveDataRef)) {
    const archivo = DriveApp.getFileById(idDrive || adjunto.driveDataRef.driveFileId);
    return { blob: archivo.getBlob(), tamanio: archivo.getSize(), tipo: archivo.getMimeType() };
  }
  const ref = adjunto.attachmentDataRef;
  if (!ref || !ref.resourceName) throw new Error('El adjunto no trae una referencia descargable.');

  const r = UrlFetchApp.fetch('https://chat.googleapis.com/v1/media/' + ref.resourceName + '?alt=media', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) {
    throw new Error('No pude bajar el audio de Chat (' + r.getResponseCode() + '). ' +
      'Subilo a Drive y mandame el enlace, que así lo leo igual.');
  }
  const largo = Number(encabezado_(r, 'content-length'));
  const blob = r.getBlob();
  return {
    blob: blob,
    tamanio: largo || blob.getBytes().length,
    tipo: adjunto.contentType || blob.getContentType(),
  };
}

function extension_(tipo) {
  const t = tipoParaGemini(tipo);
  if (t === 'audio/mp4') return '.m4a';
  if (t === 'audio/mp3' || t === 'audio/mpeg') return '.mp3';
  if (t === 'audio/ogg') return '.ogg';
  if (t === 'audio/wav') return '.wav';
  if (t === 'video/mp4') return '.mp4';
  return '';
}

/** Reuniones / AAAA-MM, dentro de la carpeta del Asistente. */
function carpetaDelMes_() {
  const raiz = DriveApp.getFolderById(exigirProp_('CARPETA_ID'));
  const reuniones = subcarpeta_(raiz, 'Reuniones');
  return subcarpeta_(reuniones, hoy_().slice(0, 7));
}

function subcarpeta_(padre, nombre) {
  const existentes = padre.getFoldersByName(nombre);
  return existentes.hasNext() ? existentes.next() : padre.createFolder(nombre);
}

// ---------- Notas ----------

function interpretarNota_(quien, entrada) {
  const hoy = hoy_();
  const gente = personas_();
  const prompt = promptNota({
    quien: quien.nombre,
    hoy: hoy,
    hoyLargo: fechaParaElModelo(hoy),
    personas: gente.map(function (p) { return p.nombre; }),
    texto: entrada.texto,
  });
  const partes = entrada.audio
    ? [parteAudioIncrustado_(entrada.audio, entrada.tipo), { text: prompt }]
    : [{ text: prompt }];

  // Chat espera como mucho 30 segundos: se acota cuánto puede pensar el modelo
  // y se le avisa cuánto tiempo queda, para saber si da para un segundo intento.
  const r = geminiJson_(partes, ESQUEMA_NOTA, {
    uso: 'nota',
    razonamiento: 512,
    hasta: (INICIO_MENSAJE_ || Date.now()) + 27000,
  });

  if (r.intencion === 'pendientes') return listarPendientes(pendientesDe_(quien.email), hoy);
  if (r.intencion === 'pedidos') return listarPedidos(pedidosDe_(quien.email), hoy);
  if (r.intencion !== 'anotar' || !(r.tareas || []).length) {
    return (r.respuesta || 'No encontré nada para anotar.') + '\n\nEscribí *ayuda* para ver qué puedo hacer.';
  }

  const anotadas = anotarTareas_(r.tareas, {
    pidio: quien.nombre,
    emailPidio: quien.email,
    origen: entrada.audio ? 'nota de voz' : 'mensaje',
    enlace: '',
  }, gente, true);
  return confirmarAnotadas(r.respuesta, anotadas, hoy);
}

/**
 * Anota cada cosa en la base y la lleva a donde la persona la va a mirar: los
 * eventos al calendario, las tareas a Google Tasks o al correo.
 *
 * Si el nombre no se puede atar a una persona concreta, se anota igual pero se
 * dice por qué no se avisó: una tarea que el responsable no sabe que tiene es
 * una tarea que no existe. Y si Calendar o Tasks fallan, lo anotado no se
 * pierde: queda en la base y se dice qué no se pudo hacer.
 *
 * @param {boolean} sinResponsableEsQuienPide en una nota, "recordame" es para
 *   quien habla. En una reunión, un compromiso sin dueño queda sin dueño.
 */
function anotarTareas_(items, origen, gente, sinResponsableEsQuienPide) {
  const yo = usuarioActual_();
  return items.map(function (item) {
    const quien = resolverResponsable_(item, origen, gente, sinResponsableEsQuienPide);
    const tipo = clasificarItem(item);

    const tarea = agregarTarea_({
      que: item.que,
      responsable: quien.nombre,
      emailResponsable: quien.email,
      plazo: esFechaIso(item.plazo) ? item.plazo : '',
      hora: normalizarHora(item.hora),
      tipo: tipo,
      pidio: origen.pidio,
      emailPidio: origen.emailPidio,
      origen: origen.origen,
      enlace: origen.enlace,
      reunion: origen.reunion || '',
    });

    const resultado = { tarea: tarea, problema: quien.problema, nota: '' };
    try {
      if (tipo === 'evento') {
        agendar_(tarea, item, quien, origen, gente, resultado);
      } else if (quien.email && quien.email === yo) {
        actualizarTarea_(tarea, { idTasks: crearGoogleTask_(tarea) });
        resultado.nota = 'En tu Google Tasks.';
      } else if (quien.email) {
        avisarTarea_(tarea, origen);
        resultado.nota = 'Le avisé por correo.';
      }
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      const donde = tipo === 'evento' ? 'agendarlo en el calendario' : 'pasarlo a Google Tasks';
      resultado.problema = [resultado.problema, 'Quedó anotado, pero no pude ' + donde + ': ' +
        (err && err.message ? err.message : err)].filter(String).join(' ');
    }
    return resultado;
  });
}

function resolverResponsable_(item, origen, gente, sinResponsableEsQuienPide) {
  const nombre = String(item.responsable || '').trim();
  if (!nombre) {
    return sinResponsableEsQuienPide
      ? { nombre: origen.pidio, email: origen.emailPidio, problema: '' }
      : { nombre: '', email: '', problema: '' };
  }
  const b = buscarPersona(gente, nombre);
  if (b.persona) return { nombre: b.persona.nombre, email: b.persona.email, problema: '' };
  if (b.candidatos.length > 1) {
    return {
      nombre: nombre,
      email: '',
      problema: 'Hay más de una persona que coincide con "' + nombre + '" (' +
        b.candidatos.map(function (p) { return p.nombre; }).join(', ') +
        '). No le avisé a nadie: cerrala y pedila de nuevo con el nombre completo.',
    };
  }
  return {
    nombre: nombre,
    email: '',
    problema: 'Todavía no conozco a "' + nombre + '", así que no le pude avisar. ' +
      'Pedile que me escriba una vez y queda registrado.',
  };
}

/**
 * El evento va al calendario de quien lo pidió. Se invita a los participantes
 * que el Asistente conoce, y al responsable si es otra persona.
 */
function agendar_(tarea, item, quien, origen, gente, resultado) {
  const invitados = [];
  const nombres = [];
  const desconocidos = [];
  (item.participantes || []).concat(quien.email && quien.email !== origen.emailPidio ? [quien.nombre] : [])
    .forEach(function (n) {
      const b = buscarPersona(gente, n);
      if (b.persona && b.persona.email !== origen.emailPidio && invitados.indexOf(b.persona.email) === -1) {
        invitados.push(b.persona.email);
        nombres.push(nombreDePila_(b.persona.nombre));
      } else if (!b.persona) {
        desconocidos.push(n);
      }
    });

  actualizarTarea_(tarea, { idCalendar: crearEvento_(tarea, invitados, item.duracionMinutos) });
  resultado.nota = 'Lo agendé en tu calendario' + (nombres.length ? ' e invité a ' + nombres.join(', ') : '') + '.';
  if (desconocidos.length) {
    resultado.nota += ' No conozco a ' + desconocidos.join(', ') + ', así que no pude invitarl' +
      (desconocidos.length > 1 ? 'os' : 'o') + '.';
  }
}

function cerrar_(quien, numero) {
  const r = cerrarTarea_(numero, quien.email);
  if (!r.ok) return r.motivo;
  const t = r.tarea;
  // Si la tarea es de otra persona, su Google Tasks se pone al día la próxima
  // vez que esa persona le escriba al Asistente.
  if (t.idTasks && t.emailResponsable === quien.email) {
    try {
      completarEnTasks_(t.idTasks);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
    }
  }
  // Cierra el círculo: quien pidió algo se entera cuando está hecho.
  if (t.emailPidio && t.emailPidio !== quien.email) avisarCierre_(t, quien);
  return 'Cerrada la *#' + numero + '* ' + t.que + '.' +
    (t.emailPidio && t.emailPidio !== quien.email ? ' Le avisé a ' + nombreDePila_(t.pidio) + '.' : '');
}
