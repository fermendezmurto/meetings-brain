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
  const sobrante = base.getSheets().filter(function (h) {
    return Object.keys(NOMBRE_HOJA).map(function (k) { return NOMBRE_HOJA[k]; }).indexOf(h.getName()) === -1;
  });
  sobrante.forEach(function (h) {
    if (h.getLastRow() === 0) base.deleteSheet(h);
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    if (f === 'procesarReuniones' || f === 'avisoMatutino') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('procesarReuniones').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('avisoMatutino').timeBased().atHour(8).everyDays(1).inTimezone(ZONA).create();

  const prueba = geminiJson_(
    [{ text: 'Respondé con ok en true.' }],
    { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] }
  );
  if (!prueba.ok) throw new Error('Gemini respondió, pero no lo esperado: ' + JSON.stringify(prueba));

  console.log([
    'Listo. Todo instalado y la clave de Gemini funciona.',
    '',
    'Carpeta: ' + carpeta.getUrl(),
    'Base:    ' + base.getUrl(),
    '',
    'Paso siguiente: compartí la carpeta "Asistente" con quienes van a usarlo, como Editor.',
  ].join('\n'));
}
