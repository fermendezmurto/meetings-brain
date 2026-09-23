/**
 * La base del Asistente es una planilla de Google Sheets. A propósito: se puede
 * abrir, leer y corregir a mano sin saber nada técnico, y para el volumen de
 * una empresa sobra.
 *
 * Cada lectura trae la hoja entera. Con miles de filas eso se nota; con las
 * decenas o cientos de un piloto, es lo más simple que funciona.
 */

const HOJAS = {
  // Las columnas nuevas van siempre al final: las filas viejas siguen valiendo.
  tareas: ['N', 'Creada', 'Qué', 'Responsable', 'Email responsable', 'Plazo', 'Estado',
    'Pidió', 'Email pidió', 'Origen', 'Enlace', 'Cerrada', 'Tipo', 'Hora',
    'ID en Calendar', 'ID en Google Tasks', 'Reunión'],
  reuniones: ['ID', 'Recibida', 'Título', 'Grabó', 'Email', 'Nota', 'Carpeta', 'Audio',
    'Tipo', 'Estado', 'Transcripción', 'Minuta', 'Error', 'Intentos', 'Archivo en Gemini',
    'Subido a Gemini', 'Duración (min)', 'Transcripto hasta (min)', 'Participantes',
    'Fallas de transcripción'],
  personas: ['Nombre', 'Email', 'Última vez'],
};

const NOMBRE_HOJA = { tareas: 'Tareas', reuniones: 'Reuniones', personas: 'Personas' };

/**
 * Abrir la planilla cuesta tiempo, y un mensaje de Chat tiene 30 segundos. Se
 * abre una vez por ejecución: Apps Script arranca cada ejecución de cero, así
 * que esto nunca queda viejo de una a otra.
 */
let LIBRO_ = null;

function libro_() {
  if (!LIBRO_) LIBRO_ = SpreadsheetApp.openById(exigirProp_('BASE_ID'));
  return LIBRO_;
}

function hoja_(clave) {
  const h = libro_().getSheetByName(NOMBRE_HOJA[clave]);
  if (!h) throw new Error('No encuentro la hoja ' + NOMBRE_HOJA[clave] + '. Corré instalar() de nuevo.');
  return h;
}

/** Las filas de datos, sin el encabezado. */
function filas_(clave) {
  const h = hoja_(clave);
  const n = h.getLastRow();
  if (n < 2) return [];
  return h.getRange(2, 1, n - 1, HOJAS[clave].length).getValues();
}

/**
 * Sheets convierte solo "2026-09-26" en una fecha con hora y zona. Se vuelve a
 * texto para que un plazo no se corra un día.
 */
function textoFecha_(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, ZONA, 'yyyy-MM-dd');
  return String(valor || '');
}

/** Varias personas escriben a la vez: las altas se hacen de a una. */
function conCandado_(fn) {
  const candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    return fn();
  } finally {
    candado.releaseLock();
  }
}

// ---------- Tareas ----------

function filaATarea_(f, i) {
  return {
    fila: i + 2,
    numero: Number(f[0]),
    creada: String(f[1]),
    que: String(f[2]),
    responsable: String(f[3]),
    emailResponsable: String(f[4]).toLowerCase(),
    plazo: textoFecha_(f[5]),
    estado: String(f[6]),
    pidio: String(f[7]),
    emailPidio: String(f[8]).toLowerCase(),
    origen: String(f[9]),
    enlace: String(f[10]),
    cerrada: String(f[11]),
    tipo: String(f[12]) || 'tarea',
    hora: String(f[13]),
    idCalendar: String(f[14]),
    idTasks: String(f[15]),
    reunion: String(f[16]),
  };
}

const COLUMNA_TAREA = { estado: 7, cerrada: 12, idCalendar: 15, idTasks: 16 };

function actualizarTarea_(t, cambios) {
  const h = hoja_('tareas');
  Object.keys(cambios).forEach(function (k) {
    h.getRange(t.fila, COLUMNA_TAREA[k]).setValue(cambios[k]);
    t[k] = cambios[k];
  });
}

function tareas_() {
  return filas_('tareas').map(filaATarea_);
}

function agregarTarea_(t) {
  return conCandado_(function () {
    const numeros = tareas_().map(function (x) { return x.numero || 0; });
    const numero = (numeros.length ? Math.max.apply(null, numeros) : 0) + 1;
    const h = hoja_('tareas');
    h.appendRow([
      numero, ahora_(), t.que, t.responsable || '', (t.emailResponsable || '').toLowerCase(),
      // El apóstrofo le dice a Sheets que es texto, no una fecha ni una hora.
      t.plazo ? "'" + t.plazo : '', 'abierta', t.pidio, (t.emailPidio || '').toLowerCase(),
      t.origen, t.enlace || '', '', t.tipo || 'tarea', t.hora ? "'" + t.hora : '', '', '',
      t.reunion || '',
    ]);
    t.numero = numero;
    t.fila = h.getLastRow();
    t.estado = 'abierta';
    t.idCalendar = '';
    t.idTasks = '';
    return t;
  });
}

/** Lo que la persona tiene por delante: sin lo cerrado ni los eventos que ya pasaron. */
function pendientesDe_(email) {
  email = String(email).toLowerCase();
  const hoy = hoy_();
  return tareas_().filter(function (t) {
    return t.estado === 'abierta' && t.emailResponsable === email && !yaOcurrio(t, hoy);
  });
}

function pedidosDe_(email) {
  email = String(email).toLowerCase();
  const hoy = hoy_();
  return tareas_().filter(function (t) {
    return t.estado === 'abierta' && t.emailPidio === email && t.emailResponsable !== email && !yaOcurrio(t, hoy);
  });
}

/** Todas las tareas de una persona, abiertas o no: las necesita la sincronización. */
function tareasDeResponsable_(email) {
  email = String(email).toLowerCase();
  return tareas_().filter(function (t) { return t.emailResponsable === email; });
}

/**
 * Solo puede cerrar una tarea quien la tiene que hacer o quien la pidió. Si no,
 * cualquiera podría dar por hecho el trabajo de otro.
 */
function cerrarTarea_(numero, email) {
  email = String(email).toLowerCase();
  return conCandado_(function () {
    const t = tareas_().filter(function (x) { return x.numero === numero; })[0];
    if (!t) return { ok: false, motivo: 'No existe la tarea #' + numero + '.' };
    if (t.estado !== 'abierta') return { ok: false, motivo: 'La #' + numero + ' ya estaba cerrada.' };
    if (t.emailResponsable !== email && t.emailPidio !== email) {
      return { ok: false, motivo: 'La #' + numero + ' no es tuya ni la pediste vos, así que no la puedo cerrar.' };
    }
    actualizarTarea_(t, { estado: 'cerrada', cerrada: ahora_() });
    return { ok: true, tarea: t };
  });
}

// ---------- Personas ----------

function personas_() {
  return filas_('personas').map(function (f) {
    return { nombre: String(f[0]), email: String(f[1]).toLowerCase() };
  }).filter(function (p) { return p.nombre; });
}

/**
 * La lista de la empresa se arma sola: cada persona que le escribe al
 * Asistente queda registrada. Nadie mantiene una nómina.
 */
function registrarPersona_(nombre, email) {
  if (!nombre || !email) return;
  email = String(email).toLowerCase();
  conCandado_(function () {
    const h = hoja_('personas');
    const existentes = filas_('personas');
    for (let i = 0; i < existentes.length; i++) {
      if (String(existentes[i][1]).toLowerCase() === email) {
        h.getRange(i + 2, 1, 1, 3).setValues([[nombre, email, ahora_()]]);
        return;
      }
    }
    h.appendRow([nombre, email, ahora_()]);
  });
}

// ---------- Reuniones ----------

function filaAReunion_(f, i) {
  return {
    fila: i + 2,
    id: String(f[0]),
    recibida: String(f[1]),
    titulo: String(f[2]),
    grabo: String(f[3]),
    email: String(f[4]).toLowerCase(),
    nota: String(f[5]),
    carpetaId: String(f[6]),
    audioId: String(f[7]),
    tipo: String(f[8]),
    estado: String(f[9]),
    transcripcionId: String(f[10]),
    minutaUrl: String(f[11]),
    error: String(f[12]),
    intentos: Number(f[13]) || 0,
    geminiUri: String(f[14]),
    subidoEn: Number(f[15]) || 0,
    duracion: Number(f[16]) || 0,
    transcriptoHasta: Number(f[17]) || 0,
    participantes: String(f[18]),
    fallasTranscripcion: Number(f[19]) || 0,
  };
}

function reuniones_() {
  return filas_('reuniones').map(filaAReunion_);
}

function encolarReunion_(r) {
  conCandado_(function () {
    hoja_('reuniones').appendRow([
      r.id, ahora_(), r.titulo, r.grabo, r.email, r.nota, r.carpetaId, r.audioId, r.tipo,
      'recibida', '', '', '', 0, '', 0, 0, 0, '', 0,
    ]);
  });
}

const COLUMNA_REUNION = {
  titulo: 3, estado: 10, transcripcionId: 11, minutaUrl: 12, error: 13, intentos: 14,
  geminiUri: 15, subidoEn: 16, duracion: 17, transcriptoHasta: 18, participantes: 19,
  fallasTranscripcion: 20,
};

function actualizarReunion_(r, cambios) {
  const h = hoja_('reuniones');
  Object.keys(cambios).forEach(function (k) {
    h.getRange(r.fila, COLUMNA_REUNION[k]).setValue(cambios[k]);
    r[k] = cambios[k];
  });
}
