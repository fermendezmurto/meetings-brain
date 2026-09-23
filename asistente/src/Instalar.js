/**
 * Se corre una sola vez, a mano, desde el editor de Apps Script. Se puede
 * volver a correr sin miedo: no duplica nada.
 *
 * Deja armado todo lo que el Asistente necesita: la carpeta en Drive, la
 * planilla que hace de base, y las dos tareas automáticas (procesar reuniones
 * cada cinco minutos y el resumen de cada mañana). Al final prueba que la clave
 * de Gemini funcione.
 */
function instalar() {
  if (!prop_('GEMINI_API_KEY')) {
    throw new Error('Primero cargá GEMINI_API_KEY: Configuración del proyecto → Propiedades del script.');
  }
  const props = PropertiesService.getScriptProperties();

  let carpeta;
  try {
    carpeta = DriveApp.getFolderById(prop_('CARPETA_ID'));
  } catch (e) {
    carpeta = DriveApp.createFolder('Asistente');
    props.setProperty('CARPETA_ID', carpeta.getId());
  }

  let base;
  try {
    base = SpreadsheetApp.openById(prop_('BASE_ID'));
  } catch (e) {
    base = SpreadsheetApp.create('Asistente — Base');
    DriveApp.getFileById(base.getId()).moveTo(carpeta);
    props.setProperty('BASE_ID', base.getId());
  }
  base.setSpreadsheetTimeZone(ZONA);

  Object.keys(HOJAS).forEach(function (clave) {
    let h = base.getSheetByName(NOMBRE_HOJA[clave]);
    if (!h) h = base.insertSheet(NOMBRE_HOJA[clave]);
    const columnas = HOJAS[clave];
    h.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold');
    h.setFrozenRows(1);
  });
  // Los plazos son texto: si Sheets los toma como fecha, les agrega hora y zona.
  base.getSheetByName('Tareas').getRange('F:F').setNumberFormat('@');
  base.getSheetByName('Tareas').getRange('N:N').setNumberFormat('@');
  const sobrante = base.getSheets().filter(function (h) {
    return Object.keys(NOMBRE_HOJA).map(function (k) { return NOMBRE_HOJA[k]; }).indexOf(h.getName()) === -1;
  });
  sobrante.forEach(function (h) {
    if (h.getLastRow() === 0) base.deleteSheet(h);
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    if (f === 'procesarReuniones' || f === 'avisoMatutino' || f === 'procesarBandeja') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('procesarReuniones').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('procesarBandeja').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('avisoMatutino').timeBased().atHour(8).everyDays(1).inTimezone(ZONA).create();

  // Qué modelos ofrece Google a esta clave, para no adivinar nombres.
  let disponibles = [];
  try {
    disponibles = modelosDisponibles_();
    const liviano = elegirModeloLiviano(disponibles);
    if (liviano && !prop_('GEMINI_MODEL_NOTAS')) props.setProperty('GEMINI_MODEL_NOTAS', liviano);
  } catch (err) {
    console.error(err);
  }

  // Una clave inválida o un modelo retirado frenan la instalación: hay que
  // corregirlos. Que un modelo esté saturado, no: Google ya aceptó la clave
  // para llegar a decir eso, y se arregla solo.
  const pruebas = [modelosPara_('nota'), modelosPara_('reunion')]
    .filter(function (m, i, todos) { return i === 0 || m.principal !== todos[0].principal; })
    .map(function (m) { return probarModelo_(m.principal, m.propiedad); });
  const estadoGemini = pruebas.some(function (p) { return p.ok; })
    ? 'la clave de Gemini funciona.'
    : 'Google aceptó la clave, pero Gemini está saturado en este momento. Los primeros mensajes pueden fallar unos minutos.';

  const faltan = [];
  try {
    CalendarApp.getDefaultCalendar().getName();
  } catch (err) {
    faltan.push('Google Calendar API (' + (err && err.message ? err.message : err) + ')');
  }
  try {
    Tasks.Tasklists.list({ maxResults: 1 });
  } catch (err) {
    faltan.push('Google Tasks API (' + (err && err.message ? err.message : err) + ')');
  }

  console.log([
    'Listo. Todo instalado y ' + estadoGemini,
    '',
    'Modelos:',
    pruebas.map(function (p) { return '  ' + p.linea; }).join('\n'),
    disponibles.length ? '  (Google ofrece ' + disponibles.length + ' modelos a esta clave.)' : '',
    faltan.length
      ? '\nATENCIÓN: no pude usar ' + faltan.join(' ni ') + '. Habilitala en el proyecto de Google Cloud y volvé a correr instalar. Mientras tanto, las tareas se anotan igual.'
      : '',
    '',
    'Carpeta: ' + carpeta.getUrl(),
    'Base:    ' + base.getUrl(),
    '',
    'Paso siguiente: compartí la carpeta "Asistente" con quienes van a usarlo, como Editor.',
  ].join('\n'));
}

/**
 * Prueba un modelo con un pedido mínimo y dice cuánto tardó. Un modelo que no
 * existe o fue retirado frena la instalación; uno saturado, no.
 */
function probarModelo_(modelo, propiedad) {
  const inicio = Date.now();
  const r = pedirGemini_(modelo, [{ text: 'Respondé con ok en true.' }], generacionPara_(modelo,
    { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] }, {}));
  const segundos = Math.round((Date.now() - inicio) / 100) / 10;
  const codigo = r.getResponseCode();
  if (codigo === 200) return { ok: true, linea: modelo + ': respondió en ' + segundos + ' s' };
  if (esErrorPasajero(codigo) || codigo === 429) {
    return { ok: false, linea: modelo + ': saturado (' + codigo + ', a los ' + segundos + ' s)' };
  }
  if (codigo === 404) throw new Error(mensajeModeloRetirado(modelo, r.getContentText(), propiedad));
  throw new Error('Gemini respondió ' + codigo + ' con ' + modelo + ': ' + r.getContentText().slice(0, 300));
}
