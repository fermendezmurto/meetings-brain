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
 * @param {Object}   opciones   uso: 'nota' (Chat, alguien esperando) o
 *                              'reunion'; hasta: momento de corte en ms;
 *                              maxTokens; razonamiento, el tope de lo que el
 *                              modelo puede "pensar" antes de contestar
 */
function geminiJson_(partes, esquema, opciones) {
  return geminiConUso_(partes, esquema, opciones).datos;
}

/** Igual que geminiJson_, pero devuelve además lo que cobró Gemini. */
function geminiConUso_(partes, esquema, opciones) {
  opciones = opciones || {};
  const modelos = modelosPara_(opciones.uso);
  const modelo = modelos.principal;
  const restante = function () { return opciones.hasta ? opciones.hasta - Date.now() : undefined; };

  // Si todos vienen lentos o fallando, ni se intenta dentro de Chat: un pedido
  // en curso no se puede cortar, y si pasa los 30 segundos la persona ve "no
  // responde". Mejor contestar al toque y terminarlo después.
  if (opciones.hasta && esperaEstimada(mediciones_()[modelo], Date.now()) > ESPERA_MAXIMA_EN_CHAT_MS) {
    throw errorPasajero_('Gemini viene lento: lo dejo para terminar después.');
  }

  const turno = modelos.orden.slice();
  const maximo = opciones.hasta ? MAX_PEDIDOS_CON_CORTE : MAX_PEDIDOS_SIN_CORTE;

  let r = pedirConAjuste_(modelo, partes, esquema, opciones);
  for (let n = 1; n < maximo && turno.length && convieneReintentar(r.getResponseCode(), restante()); n++) {
    // Probados todos una vez, se espera un poco antes de la vuelta siguiente.
    if (n >= turno.length) Utilities.sleep(1500);
    const siguiente = modeloDelIntento(turno, n);
    const r2 = pedirConAjuste_(siguiente, partes, esquema, opciones);
    // Contestó, o se llegó al límite de pedidos: insistir ahí solo lo empeora.
    if (r2.getResponseCode() === 200 || r2.getResponseCode() === 429) {
      r = r2;
      break;
    }
    if (!esErrorPasajero(r2.getResponseCode())) {
      // Un respaldo que no existe o rechaza el pedido se saca de la vuelta: la
      // persona igual recibe el aviso de saturación, nunca un error técnico
      // del respaldo.
      console.error('El respaldo ' + siguiente + ' no sirve (' + r2.getResponseCode() + '): ' +
        r2.getContentText().slice(0, 200));
      turno.splice(turno.indexOf(siguiente), 1);
    }
  }

  const codigo = r.getResponseCode();
  const cuerpo = r.getContentText();
  if (codigo === 429) {
    throw errorPasajero_('Gemini llegó al límite de pedidos del nivel gratuito. Probá de nuevo en un rato.');
  }
  if (esErrorPasajero(codigo)) {
    throw errorPasajero_('Gemini está saturado en este momento. Suele pasar unos minutos: probá de nuevo en un rato.');
  }
  if (codigo === 404 && /no longer available|not found/i.test(cuerpo)) {
    throw new Error(mensajeModeloRetirado(modelo, cuerpo, modelos.propiedad));
  }
  if (codigo !== 200) throw new Error('Gemini respondió ' + codigo + ': ' + cuerpo.slice(0, 400));

  const datos = JSON.parse(cuerpo);
  const candidato = (datos.candidates || [])[0];
  if (!candidato) throw new Error('Gemini no devolvió respuesta: ' + cuerpo.slice(0, 300));
  if (candidato.finishReason === 'MAX_TOKENS') {
    throw new Error('La respuesta no entró en el límite de Gemini. Si es una reunión, probá con una más corta.');
  }
  const texto = ((candidato.content || {}).parts || [])
    .filter(function (p) { return !p.thought; })
    .map(function (p) { return p.text || ''; })
    .join('');
  if (!texto) throw new Error('Gemini devolvió una respuesta vacía (' + candidato.finishReason + ').');
  return { datos: JSON.parse(texto), uso: datos.usageMetadata || {} };
}

/** Un error que se arregla solo esperando: quien lo recibe puede reintentar. */
function errorPasajero_(mensaje) {
  const e = new Error(mensaje);
  e.pasajero = true;
  return e;
}

/**
 * Un pedido, con un solo ajuste: si el modelo no acepta cómo se le acotó el
 * razonamiento, se pide de nuevo sin acotarlo. Más lento, pero contesta.
 */
function pedirConAjuste_(modelo, partes, esquema, opciones) {
  const inicio = Date.now();
  let r = pedirGemini_(modelo, partes, generacionPara_(modelo, esquema, opciones));
  if (r.getResponseCode() === 400 && configRazonamiento(modelo, opciones.razonamiento) &&
      /thinking/i.test(r.getContentText())) {
    r = pedirGemini_(modelo, partes, generacionPara_(modelo, esquema, { maxTokens: opciones.maxTokens }));
  }
  // Cada pedido deja su medición: así Chat sabe cuál modelo viene más rápido.
  const codigo = r.getResponseCode();
  if (codigo === 200 || esErrorPasajero(codigo) || codigo === 429) {
    try {
      medir_(modelo, Date.now() - inicio, codigo === 200);
    } catch (err) {
      console.error(err);
    }
  }
  return r;
}

function generacionPara_(modelo, esquema, opciones) {
  const generacion = {
    responseMimeType: 'application/json',
    responseSchema: esquema,
    temperature: 0.2,
  };
  if (opciones.maxTokens) generacion.maxOutputTokens = opciones.maxTokens;
  const razonamiento = configRazonamiento(modelo, opciones.razonamiento);
  if (razonamiento) generacion.thinkingConfig = razonamiento;
  return generacion;
}

function pedirGemini_(modelo, partes, generacion) {
  return UrlFetchApp.fetch(GEMINI + '/v1beta/models/' + modelo + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': claveGemini_() },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: generacion }),
    muteHttpExceptions: true,
  });
}

/** Un audio chico va dentro del mismo pedido: una sola llamada, respuesta inmediata. */
function parteAudioIncrustado_(blob, tipo) {
  return { inline_data: { mime_type: tipoParaGemini(tipo), data: Utilities.base64Encode(blob.getBytes()) } };
}

/**
 * Un audio grande se sube primero a la Files API y se usa por referencia.
 * Apps Script no deja bajar ni mandar más de 50 MB de una vez, así que un
 * audio largo (una reunión de tres horas) se lee de Drive de a pedazos y se le
 * entrega a Gemini en el mismo orden, sin tenerlo nunca entero en memoria. Los
 * pedazos van como blob, nunca como arreglo de bytes, por lo mismo.
 */
const TRAMO_SUBIDA_BYTES = 16 * 1024 * 1024;

function subirDeDriveAGemini_(idArchivo, tamanio, tipo, nombre) {
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
  // Cada pedazo, salvo el último, tiene que ser múltiplo de lo que pide Gemini.
  const granularidad = Number(encabezado_(inicio, 'x-goog-upload-chunk-granularity')) || 8 * 1024 * 1024;
  const tramo = Math.max(1, Math.floor(TRAMO_SUBIDA_BYTES / granularidad)) * granularidad;

  let archivo = null;
  for (let desde = 0; desde < tamanio; desde += tramo) {
    const hasta = Math.min(desde + tramo, tamanio) - 1;
    const ultimo = hasta === tamanio - 1;
    const pedazo = leerDeDrive_(idArchivo, desde, hasta);
    const r = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { 'X-Goog-Upload-Offset': String(desde), 'X-Goog-Upload-Command': ultimo ? 'upload, finalize' : 'upload' },
      payload: pedazo,
      muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 200) {
      throw new Error('Gemini falló al recibir el audio: ' + r.getContentText().slice(0, 300));
    }
    if (ultimo) archivo = JSON.parse(r.getContentText()).file;
  }
  if (!archivo) throw new Error('El audio está vacío.');
  esperarActivo_(archivo.name);
  return { file_data: { mime_type: mime, file_uri: archivo.uri } };
}

/** Un pedazo de un archivo de Drive, del byte desde al hasta inclusive. */
function leerDeDrive_(idArchivo, desde, hasta) {
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + idArchivo + '?alt=media&supportsAllDrives=true', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + desde + '-' + hasta },
    muteHttpExceptions: true,
  });
  const codigo = r.getResponseCode();
  if (codigo !== 206 && codigo !== 200) {
    throw new Error('Drive no devolvió el audio (' + codigo + '): ' + r.getContentText().slice(0, 200));
  }
  return r.getBlob();
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

/**
 * Los modelos que Google ofrece a esta clave. Sirve para no adivinar nombres:
 * Google los cambia seguido y retira los viejos.
 */
function modelosDisponibles_() {
  const nombres = [];
  let pagina = '';
  do {
    const r = UrlFetchApp.fetch(GEMINI + '/v1beta/models?pageSize=1000' + (pagina ? '&pageToken=' + pagina : ''), {
      headers: { 'x-goog-api-key': claveGemini_() },
      muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 200) throw new Error('Google no devolvió la lista de modelos (' + r.getResponseCode() + ').');
    const datos = JSON.parse(r.getContentText());
    (datos.models || []).forEach(function (m) {
      if ((m.supportedGenerationMethods || []).indexOf('generateContent') !== -1) nombres.push(m.name);
    });
    pagina = datos.nextPageToken || '';
  } while (pagina);
  return nombres;
}
