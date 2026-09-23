/**
 * Procesa las reuniones que llegaron por Chat. Corre sola cada cinco minutos
 * (la programa instalar()), con la cuenta de quien instaló el Asistente.
 *
 * Cada reunión pasa por estos estados, y cada paso queda guardado en la
 * planilla para que un corte no obligue a empezar de cero:
 *
 *   recibida       el audio está en Drive
 *   subida         el audio está en Gemini
 *   transcribiendo la minuta ya salió y las tareas ya se repartieron; la
 *                  transcripción literal se va completando por tramos
 *   completa       todo listo
 *   error          falló tres veces antes de llegar a la minuta; se avisa
 *
 * Por qué por tramos: Apps Script corta cualquier pedido a los 60 segundos, y
 * transcribir una hora de una vez tarda bastante más. La minuta, que es corta,
 * sale en un solo pedido; la transcripción se pide de a MINUTOS_POR_TRAMO.
 */

const MAX_INTENTOS = 3;
/**
 * Si el problema es que Gemini está saturado, se sigue probando durante una
 * hora (una vez cada cinco minutos) antes de avisar que no se pudo.
 */
const MAX_INTENTOS_PASAJEROS = 12;
const MAX_FALLAS_TRANSCRIPCION = 5;
/** Margen antes del corte de seis minutos de Apps Script. */
const PRESUPUESTO_MS = 4 * 60 * 1000;
/** Gemini borra los archivos a las 48 horas. Se vuelve a subir antes. */
const VIDA_EN_GEMINI_MS = 40 * 60 * 60 * 1000;
const AVISO_TRANSCRIPCION = 'La transcripción completa se está armando y aparece acá en los próximos minutos.';

function procesarReuniones() {
  if (!tomarTurno_()) return;
  try {
    procesarPendientes_();
  } finally {
    soltarTurno_();
  }
}

/**
 * Que dos corridas no procesen la misma reunión a la vez. No se usa el candado
 * del script durante todo el proceso porque son minutos, y mientras tanto la
 * gente que escribe en Chat quedaría esperando. El turno vence solo, por si una
 * corrida se corta sin soltarlo.
 */
function tomarTurno_() {
  const candado = LockService.getScriptLock();
  if (!candado.tryLock(5000)) return false;
  try {
    const props = PropertiesService.getScriptProperties();
    if (Number(props.getProperty('PROCESANDO_HASTA') || 0) > Date.now()) return false;
    props.setProperty('PROCESANDO_HASTA', String(Date.now() + 7 * 60 * 1000));
    return true;
  } finally {
    candado.releaseLock();
  }
}

function soltarTurno_() {
  PropertiesService.getScriptProperties().deleteProperty('PROCESANDO_HASTA');
}

function procesarPendientes_() {
  const inicio = Date.now();
  const quedaTiempo = function () { return Date.now() - inicio < PRESUPUESTO_MS; };

  // Primero las que todavía no tienen minuta: es lo que alguien está esperando.
  const antesDeLaMinuta = reuniones_().filter(function (r) {
    return r.estado === 'recibida' || r.estado === 'subida';
  });
  for (let i = 0; i < antesDeLaMinuta.length && quedaTiempo(); i++) {
    const r = antesDeLaMinuta[i];
    try {
      if (r.estado === 'recibida') {
        asegurarEnGemini_(r);
        actualizarReunion_(r, { estado: 'subida' });
      }
      if (r.estado === 'subida' && quedaTiempo()) escribirMinuta_(r);
    } catch (err) {
      registrarFalla_(r, err);
    }
  }

  // Después, un tramo de transcripción por reunión y por corrida.
  const enTranscripcion = reuniones_().filter(function (r) { return r.estado === 'transcribiendo'; });
  for (let i = 0; i < enTranscripcion.length && quedaTiempo(); i++) {
    const r = enTranscripcion[i];
    try {
      transcribirTramo_(r);
    } catch (err) {
      console.error('Transcripción de ' + r.id + ': ' + (err && err.stack ? err.stack : err));
      const fallas = r.fallasTranscripcion + 1;
      actualizarReunion_(r, { fallasTranscripcion: fallas, error: mensajeDe_(err) });
      if (fallas >= MAX_FALLAS_TRANSCRIPCION) {
        // La minuta ya se entregó: se deja constancia y no se insiste más.
        cerrarTranscripcion_(r, 'No se pudo completar la transcripción literal (' + mensajeDe_(err) +
          '). El audio completo está en la carpeta de la reunión.');
      }
    }
  }
}

function mensajeDe_(err) {
  return String(err && err.message ? err.message : err).slice(0, 500);
}

function registrarFalla_(r, err) {
  console.error('Reunión ' + r.id + ': ' + (err && err.stack ? err.stack : err));
  const intentos = r.intentos + 1;
  const limite = err && err.pasajero ? MAX_INTENTOS_PASAJEROS : MAX_INTENTOS;
  const seRinde = intentos >= limite;
  actualizarReunion_(r, {
    intentos: intentos,
    error: mensajeDe_(err),
    estado: seRinde ? 'error' : r.estado,
  });
  if (seRinde) avisarFalla_(r);
}

/** Sube el audio a Gemini si no está, o si está por vencer. */
function asegurarEnGemini_(r) {
  if (r.geminiUri && Date.now() - r.subidoEn < VIDA_EN_GEMINI_MS) return;
  const audio = DriveApp.getFileById(r.audioId);
  const parte = subirAGemini_(audio.getBlob(), audio.getSize(), r.tipo || audio.getMimeType(), audio.getName());
  actualizarReunion_(r, { geminiUri: parte.file_data.file_uri, subidoEn: Date.now() });
}

function parteDeGemini_(r) {
  return { file_data: { mime_type: tipoParaGemini(r.tipo), file_uri: r.geminiUri } };
}

function escribirMinuta_(r) {
  asegurarEnGemini_(r);
  const gente = personas_();
  const fecha = r.recibida.slice(0, 10);

  const respuesta = geminiConUso_([parteDeGemini_(r), {
    text: promptMinuta({
      fecha: fecha,
      fechaLargo: fechaParaElModelo(fecha),
      quien: r.grabo,
      nota: r.nota,
      personas: gente.map(function (p) { return p.nombre; }),
    }),
  }], ESQUEMA_MINUTA, { razonamiento: 1024 });
  const m = respuesta.datos;
  // Lo que cobró Gemini dice la duración exacta; lo que estima el modelo, no.
  const duracion = minutosDeAudio(respuesta.uso) || Number(m.duracionMinutos) || 60;

  const carpeta = DriveApp.getFolderById(r.carpetaId);
  carpeta.setName(fecha + ' — ' + (m.titulo || 'Reunión'));
  const doc = crearDocMinuta_(m, r, fecha, carpeta);

  const anotadas = anotarTareas_((m.compromisos || []).map(function (c) {
    return { tipo: 'tarea', que: c.que, responsable: c.responsable, plazo: c.plazo };
  }), {
    pidio: r.grabo,
    emailPidio: r.email,
    origen: 'reunión: ' + m.titulo,
    enlace: doc.getUrl(),
    reunion: r.id,
  }, gente, false);
  guardarDatosDeMinuta_(r, m, fecha, duracion, doc, carpeta, anotadas);

  actualizarReunion_(r, {
    titulo: m.titulo,
    minutaUrl: doc.getUrl(),
    duracion: duracion,
    transcriptoHasta: 0,
    participantes: (m.participantes || []).map(function (p) { return p.nombre; }).join(', '),
    estado: 'transcribiendo',
    error: '',
  });
  avisarMinuta_(r, m, doc.getUrl(), anotadas);
}

/**
 * La minuta como datos, al lado del documento. El documento es para leer; esto
 * es para que otro sistema (el cerebro de la empresa) la pueda usar sin tener
 * que interpretar texto. La forma está descripta en asistente/DATOS.md.
 */
function guardarDatosDeMinuta_(r, m, fecha, duracion, doc, carpeta, anotadas) {
  carpeta.createFile('minuta.json', JSON.stringify(datosDeMinuta(r, m, fecha, duracion, {
    minuta: doc.getUrl(),
    carpeta: carpeta.getUrl(),
    audio: DriveApp.getFileById(r.audioId).getUrl(),
  }, anotadas), null, 2), 'application/json');
}

/** La minuta como documento de Google: editable y comentable, no un texto muerto. */
function crearDocMinuta_(m, r, fecha, carpeta) {
  const doc = DocumentApp.create(fecha + ' — ' + (m.titulo || 'Reunión'));
  const cuerpo = doc.getBody();
  cuerpo.appendParagraph(m.titulo || 'Reunión').setHeading(DocumentApp.ParagraphHeading.TITLE);
  cuerpo.appendParagraph(fechaParaElModelo(fecha) + ' · Grabó ' + r.grabo);
  cuerpo.appendParagraph('Resumen').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  cuerpo.appendParagraph(m.resumen || '');

  seccionesMinuta(m).forEach(function (s) {
    cuerpo.appendParagraph(s.titulo).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    if (!s.items.length) {
      cuerpo.appendParagraph(s.vacio).setItalic(true);
      return;
    }
    s.items.forEach(function (item) {
      cuerpo.appendListItem(item).setGlyphType(DocumentApp.GlyphType.BULLET);
    });
  });

  cuerpo.appendPageBreak();
  cuerpo.appendParagraph('Transcripción').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  cuerpo.appendParagraph(AVISO_TRANSCRIPCION).setItalic(true);

  // Sin esto la primera línea queda como un párrafo vacío arriba del título.
  const primero = cuerpo.getChild(0);
  if (primero.getType() === DocumentApp.ElementType.PARAGRAPH && !primero.asParagraph().getText()) {
    primero.removeFromParent();
  }
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(carpeta);
  return doc;
}

/** Un tramo de la transcripción literal, agregado al archivo de texto. */
function transcribirTramo_(r) {
  if (r.transcriptoHasta >= r.duracion) {
    cerrarTranscripcion_(r, null);
    return;
  }
  asegurarEnGemini_(r);
  const desde = r.transcriptoHasta;
  const hasta = Math.min(desde + MINUTOS_POR_TRAMO, r.duracion);

  const t = geminiJson_([parteDeGemini_(r), {
    text: promptTramo({
      desde: desde,
      hasta: hasta,
      participantes: r.participantes ? r.participantes.split(', ') : [],
    }),
  }], ESQUEMA_TRAMO, { razonamiento: 0, maxTokens: 16384 });

  const texto = renderizarTurnos(t.turnos);
  if (texto) {
    if (r.transcripcionId) {
      const archivo = DriveApp.getFileById(r.transcripcionId);
      archivo.setContent(archivo.getBlob().getDataAsString() + '\n' + texto);
    } else {
      const archivo = DriveApp.getFolderById(r.carpetaId).createFile('transcripcion.txt', texto, 'text/plain');
      actualizarReunion_(r, { transcripcionId: archivo.getId() });
    }
  }
  actualizarReunion_(r, { transcriptoHasta: hasta, error: '' });
  if (hasta >= r.duracion) cerrarTranscripcion_(r, null);
}

/**
 * Pasa la transcripción al documento de la minuta, en lugar del aviso de que se
 * estaba armando, y da la reunión por completa.
 *
 * @param {string|null} problema si no se pudo completar, lo que se deja escrito
 */
function cerrarTranscripcion_(r, problema) {
  const texto = r.transcripcionId ? DriveApp.getFileById(r.transcripcionId).getBlob().getDataAsString() : '';
  const final = problema
    ? (texto ? texto + '\n\n' : '') + problema
    : (texto || 'No se registró conversación en el audio.');

  if (r.minutaUrl) {
    const doc = DocumentApp.openByUrl(r.minutaUrl);
    const aviso = doc.getBody().getParagraphs().filter(function (p) {
      return p.getText() === AVISO_TRANSCRIPCION;
    })[0];
    if (aviso) aviso.setText(final).setItalic(false).setFontSize(9);
    doc.saveAndClose();
  }
  actualizarReunion_(r, { estado: 'completa' });
}
