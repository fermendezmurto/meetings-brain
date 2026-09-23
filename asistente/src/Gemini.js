/**
 * Cliente de la API de Gemini sobre UrlFetchApp.
 *
 * La clave viaja en un encabezado y no en la dirección: así no queda en ningún
 * registro de URLs.
 */

const GEMINI = 'https://generativelanguage.googleapis.com';

function claveGemini_() {
  return exigirProp_('GEMINI_API_KEY');
}

/**
 * Pide una respuesta con forma fija y la devuelve ya interpretada.
 *
 * @param {Object[]} partes     texto, audio incrustado o referencia a un archivo
 * @param {Object}   esquema    la forma exacta de la respuesta
 * @param {Object}   opciones   maxTokens; razonamiento, el tope de lo que el
 *                              modelo puede "pensar" antes de contestar
 */
function geminiJson_(partes, esquema, opciones) {
  return geminiConUso_(partes, esquema, opciones).datos;
}

/** Igual que geminiJson_, pero devuelve además lo que cobró Gemini. */
function geminiConUso_(partes, esquema, opciones) {
  opciones = opciones || {};
  const modelo = prop_('GEMINI_MODEL', MODELO_POR_DEFECTO);

  const generacion = {
    responseMimeType: 'application/json',
    responseSchema: esquema,
    temperature: 0.2,
  };
  if (opciones.maxTokens) generacion.maxOutputTokens = opciones.maxTokens;
  // Apps Script corta los pedidos a los 60 segundos, y el razonamiento sin tope
  // puede solo gastarse ese minuto. Se acota en la familia 2.5 Flash, que es la
  // que admite el parámetro; en otros modelos no se manda, para no provocar un error.
  if (opciones.razonamiento !== undefined && /^gemini-2\.5-flash/.test(modelo)) {
    generacion.thinkingConfig = { thinkingBudget: opciones.razonamiento };
  }

  const r = UrlFetchApp.fetch(GEMINI + '/v1beta/models/' + modelo + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': claveGemini_() },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: generacion }),
    muteHttpExceptions: true,
  });
  const codigo = r.getResponseCode();
  const cuerpo = r.getContentText();
  if (codigo === 429) {
    throw new Error('Gemini llegó al límite de pedidos del nivel gratuito. Probá de nuevo en un rato.');
  }
  if (codigo !== 200) throw new Error('Gemini respondió ' + codigo + ': ' + cuerpo.slice(0, 400));

  const datos = JSON.parse(cuerpo);
  const candidato = (datos.candidates || [])[0];
  if (!candidato) throw new Error('Gemini no devolvió respuesta: ' + cuerpo.slice(0, 300));
  if (candidato.finishReason === 'MAX_TOKENS') {
    throw new Error('La respuesta no entró en el límite de Gemini. Si es una reunión, probá con una más corta.');
  }
  const texto = ((candidato.content || {}).parts || [])
    .map(function (p) { return p.text || ''; })
    .join('');
  if (!texto) throw new Error('Gemini devolvió una respuesta vacía (' + candidato.finishReason + ').');
  return { datos: JSON.parse(texto), uso: datos.usageMetadata || {} };
}

/** Un audio chico va dentro del mismo pedido: una sola llamada, respuesta inmediata. */
function parteAudioIncrustado_(blob, tipo) {
  return { inline_data: { mime_type: tipoParaGemini(tipo), data: Utilities.base64Encode(blob.getBytes()) } };
}

/**
 * Un audio grande se sube primero a la Files API y se usa por referencia. El
 * blob se manda tal cual, sin pasarlo a un arreglo de bytes: una reunión
 * convertida a arreglo no entra en la memoria de Apps Script.
 *
 * @param {number} tamanio en bytes. Se pide aparte porque medir el blob
 *   obligaría a cargarlo entero en memoria.
 */
function subirAGemini_(blob, tamanio, tipo, nombre) {
  const mime = tipoParaGemini(tipo);
  const inicio = UrlFetchApp.fetch(GEMINI + '/upload/v1beta/files', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': claveGemini_(),
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(tamanio),
      'X-Goog-Upload-Header-Content-Type': mime,
    },
    payload: JSON.stringify({ file: { display_name: nombre } }),
    muteHttpExceptions: true,
  });
  if (inicio.getResponseCode() !== 200) {
    throw new Error('Gemini rechazó la subida: ' + inicio.getContentText().slice(0, 300));
  }
  const url = encabezado_(inicio, 'x-goog-upload-url');
  if (!url) throw new Error('Gemini no devolvió la dirección de subida.');

  const subida = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    payload: blob,
    muteHttpExceptions: true,
  });
  if (subida.getResponseCode() !== 200) {
    throw new Error('Gemini falló al recibir el audio: ' + subida.getContentText().slice(0, 300));
  }
  const archivo = JSON.parse(subida.getContentText()).file;
  esperarActivo_(archivo.name);
  return { file_data: { mime_type: mime, file_uri: archivo.uri } };
}

/** Gemini tarda unos segundos en dejar listo un audio recién subido. */
function esperarActivo_(nombre) {
  for (let i = 0; i < 40; i++) {
    const r = UrlFetchApp.fetch(GEMINI + '/v1beta/' + nombre, {
      headers: { 'x-goog-api-key': claveGemini_() },
      muteHttpExceptions: true,
    });
    const estado = JSON.parse(r.getContentText()).state;
    if (estado === 'ACTIVE') return;
    if (estado === 'FAILED') throw new Error('Gemini no pudo leer el audio. ¿Es un formato de audio común?');
    Utilities.sleep(3000);
  }
  throw new Error('Gemini tardó demasiado en preparar el audio.');
}

/** Los nombres de encabezado llegan con mayúsculas distintas según el servidor. */
function encabezado_(respuesta, nombre) {
  const todos = respuesta.getAllHeaders();
  const clave = Object.keys(todos).filter(function (k) { return k.toLowerCase() === nombre; })[0];
  return clave ? String(todos[clave]) : '';
}
