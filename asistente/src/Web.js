/**
 * La app del celular le habla al Asistente por acá.
 *
 * Esta parte se publica como aplicación web: corre con la cuenta de quien
 * instaló y la puede llamar cualquiera, porque la app no inicia sesión con
 * Google. Lo que la protege es el código que cada persona pide en Chat
 * ("vincular"): la app lo cambia por una clave larga, que queda guardada en el
 * teléfono y dice de quién es cada grabación.
 *
 * Una grabación sube de a partes directo a una subida reanudable de Drive. Si
 * se corta la señal a la mitad, la app pregunta cuánto llegó y sigue desde ahí:
 * nunca se vuelve a mandar lo que ya está.
 */

/** Cambia si la app y el Asistente dejan de entenderse. */
const VERSION_API_APP = 1;

/** Cuánto manda la app por pedido. Drive pide múltiplos de 256 KB. */
const PARTE_APP_BYTES = 4 * 1024 * 1024;

/** Unas diez horas de reunión con la calidad que graba la app. */
const LIMITE_GRABACION_BYTES = 500 * 1024 * 1024;

const VIDA_CODIGO_S = 600;
const MAX_FALLAS_CODIGO = 20;

function doGet() {
  return json_({ ok: true, servicio: 'Asistente', version: VERSION_API_APP });
}

function doPost(e) {
  let pedido;
  try {
    pedido = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'No entendí el pedido.' });
  }
  try {
    return json_(atenderApp_(pedido));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({
      ok: false,
      error: err && err.message ? err.message : String(err),
      desvinculado: Boolean(err && err.desvinculado),
      reiniciar: Boolean(err && err.reiniciar),
      // Lo que no se arregla reintentando: la app lo muestra y no insiste.
      definitivo: Boolean(err && err.definitivo),
    });
  }
}

function json_(datos) {
  return ContentService.createTextOutput(JSON.stringify(datos)).setMimeType(ContentService.MimeType.JSON);
}

function atenderApp_(p) {
  if (p.accion === 'vincular') return vincularTelefono_(p.codigo, p.dispositivo);
  const quien = telefono_(p.token);
  if (p.accion === 'yo') return { ok: true, nombre: quien.nombre, email: quien.email, parteBytes: PARTE_APP_BYTES };
  if (p.accion === 'iniciar') return iniciarGrabacion_(quien, p);
  if (p.accion === 'parte') return recibirParte_(quien, p);
  if (p.accion === 'estado') return estadoDeGrabaciones_(quien, p.ids || []);
  throw new Error('No sé hacer "' + p.accion + '". ¿La app está actualizada?');
}

function errorCon_(mensaje, marcas) {
  const err = new Error(mensaje);
  Object.keys(marcas).forEach(function (k) { err[k] = marcas[k]; });
  return err;
}

// ---------- Vincular el teléfono ----------

/** Lo pide la persona en Chat: ahí el Asistente ya sabe quién es. */
function codigoDeVinculacion_(quien) {
  const cache = CacheService.getScriptCache();
  let codigo;
  do {
    codigo = String(Math.floor(100000 + Math.random() * 900000));
  } while (cache.get('vincular:' + codigo));
  cache.put('vincular:' + codigo, JSON.stringify({ nombre: quien.nombre, email: quien.email }), VIDA_CODIGO_S);
  return codigo;
}

function vincularTelefono_(codigo, dispositivo) {
  const cache = CacheService.getScriptCache();
  // Seis cifras se adivinan probando: después de unos cuantos errores, se
  // deja de aceptar códigos por un rato.
  const fallas = Number(cache.get('vincular-fallas') || 0);
  if (fallas >= MAX_FALLAS_CODIGO) throw new Error('Hubo demasiados códigos equivocados. Probá de nuevo en 10 minutos.');

  const limpio = String(codigo || '').replace(/\D/g, '');
  const guardado = limpio ? cache.get('vincular:' + limpio) : null;
  if (!guardado) {
    cache.put('vincular-fallas', String(fallas + 1), VIDA_CODIGO_S);
    throw new Error('Ese código no existe o ya venció. Escribile "vincular" al Asistente en Chat para pedir otro.');
  }
  cache.remove('vincular:' + limpio);

  const quien = JSON.parse(guardado);
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
  PropertiesService.getScriptProperties().setProperty('TELEFONO_' + token, JSON.stringify({
    nombre: quien.nombre,
    email: quien.email,
    dispositivo: String(dispositivo || '').slice(0, 80),
    desde: ahora_(),
  }));
  return { ok: true, token: token, nombre: quien.nombre, email: quien.email, parteBytes: PARTE_APP_BYTES };
}

function telefono_(token) {
  const limpio = String(token || '');
  const guardado = /^[0-9a-f]{64}$/.test(limpio)
    ? PropertiesService.getScriptProperties().getProperty('TELEFONO_' + limpio)
    : null;
  if (!guardado) {
    throw errorCon_('Este teléfono no está vinculado. Escribile "vincular" al Asistente en Chat para pedir un código.',
      { desvinculado: true });
  }
  return JSON.parse(guardado);
}

// ---------- Recibir una grabación ----------

function idDeGrabacion_(texto) {
  const id = String(texto || '').toLowerCase();
  if (!/^[0-9a-z]{6,32}$/.test(id)) throw errorCon_('La grabación no trae un identificador válido.', { definitivo: true });
  return id;
}

function tipoDeGrabacion_(tipo) {
  const t = String(tipo || '').toLowerCase().split(';')[0].trim();
  return /^audio\/[\w.+-]+$/.test(t) ? t : 'audio/mp4';
}

function subida_(id) {
  const s = PropertiesService.getScriptProperties().getProperty('SUBIDA_' + id);
  return s ? JSON.parse(s) : null;
}

function guardarSubida_(id, s) {
  PropertiesService.getScriptProperties().setProperty('SUBIDA_' + id, JSON.stringify(s));
}

function borrarSubida_(id) {
  PropertiesService.getScriptProperties().deleteProperty('SUBIDA_' + id);
}

function reunionPorId_(id) {
  return reuniones_().filter(function (r) { return r.id === id; })[0] || null;
}

/**
 * Abre en Drive el lugar donde va a quedar el audio. Se puede llamar de nuevo
 * con la misma grabación (la app reintenta si no le llegó la respuesta): en ese
 * caso contesta por dónde iba.
 */
function iniciarGrabacion_(quien, p) {
  const id = idDeGrabacion_(p.id);
  const tamanio = Number(p.tamanio);
  if (!(tamanio > 0)) throw errorCon_('La grabación está vacía.', { definitivo: true });
  if (tamanio > LIMITE_GRABACION_BYTES) {
    throw errorCon_('La grabación pesa ' + Math.round(tamanio / 1048576) + ' MB y el máximo es ' +
      Math.round(LIMITE_GRABACION_BYTES / 1048576) + ' MB.', { definitivo: true });
  }

  return conCandado_(function () {
    const ya = subida_(id);
    if (ya) {
      if (ya.email !== quien.email) throw errorCon_('Esa grabación es de otra persona.', { definitivo: true });
      return { ok: true, recibidos: ya.recibidos, parteBytes: PARTE_APP_BYTES };
    }
    const hecha = reunionPorId_(id);
    if (hecha) {
      if (hecha.email !== quien.email) throw errorCon_('Esa grabación es de otra persona.', { definitivo: true });
      return { ok: true, recibidos: tamanio, terminada: true };
    }

    const tipo = tipoDeGrabacion_(p.tipo);
    const carpeta = carpetaDelMes_().createFolder(hoy_() + ' — ' + quien.nombre + ' — ' + id);
    const r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': tipo,
        'X-Upload-Content-Length': String(tamanio),
      },
      payload: JSON.stringify({ name: 'audio-' + id + extension_(tipo), parents: [carpeta.getId()], mimeType: tipo }),
      muteHttpExceptions: true,
    });
    const sesion = r.getResponseCode() === 200 ? encabezado_(r, 'location') : '';
    if (!sesion) {
      carpeta.setTrashed(true);
      throw new Error('Drive no aceptó la grabación (' + r.getResponseCode() + '). Reintento en un rato.');
    }
    guardarSubida_(id, {
      email: quien.email,
      nombre: quien.nombre,
      carpetaId: carpeta.getId(),
      sesion: sesion,
      tamanio: tamanio,
      tipo: tipo,
      recibidos: 0,
      nota: String(p.nota || '').slice(0, 500),
    });
    return { ok: true, recibidos: 0, parteBytes: PARTE_APP_BYTES };
  });
}

function recibirParte_(quien, p) {
  const id = idDeGrabacion_(p.id);
  const s = subida_(id);
  if (!s) {
    const hecha = reunionPorId_(id);
    if (hecha && hecha.email === quien.email) return { ok: true, terminada: true };
    throw errorCon_('No encuentro esa grabación. La app la vuelve a mandar desde el principio.', { reiniciar: true });
  }
  if (s.email !== quien.email) throw errorCon_('Esa grabación es de otra persona.', { definitivo: true });

  const desde = Number(p.desde);
  // Una parte repetida (no le llegó la respuesta anterior) o un salto: se le
  // pregunta a Drive cuánto tiene, y la app sigue desde ahí.
  if (desde !== s.recibidos) return alinearSubida_(id, s);

  const bytes = Utilities.base64Decode(String(p.datos || ''));
  const hasta = desde + bytes.length - 1;
  const ultima = hasta === s.tamanio - 1;
  if (!bytes.length || hasta >= s.tamanio || (!ultima && bytes.length % (256 * 1024) !== 0)) {
    throw new Error('La parte llegó mal armada.');
  }
  const r = UrlFetchApp.fetch(s.sesion, {
    method: 'put',
    contentType: s.tipo,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Range': 'bytes ' + desde + '-' + hasta + '/' + s.tamanio },
    payload: bytes,
    muteHttpExceptions: true,
    // Drive contesta 308 a cada parte que no es la última: no es una redirección.
    followRedirects: false,
  });
  const codigo = r.getResponseCode();
  if (codigo === 200 || codigo === 201 || codigo === 308) return resultadoDeDrive_(id, s, r);
  return alinearSubida_(id, s);
}

function alinearSubida_(id, s) {
  const r = UrlFetchApp.fetch(s.sesion, {
    method: 'put',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Range': 'bytes */' + s.tamanio },
    payload: '',
    muteHttpExceptions: true,
    followRedirects: false,
  });
  return resultadoDeDrive_(id, s, r);
}

function resultadoDeDrive_(id, s, r) {
  const codigo = r.getResponseCode();
  if (codigo === 200 || codigo === 201) return terminarGrabacion_(id, s, JSON.parse(r.getContentText()).id);
  if (codigo === 308) {
    // "bytes=0-4194303": lo que Drive ya tiene guardado.
    const rango = encabezado_(r, 'range');
    s.recibidos = rango ? Number(rango.split('-')[1]) + 1 : 0;
    guardarSubida_(id, s);
    return { ok: true, recibidos: s.recibidos };
  }
  if (codigo === 404 || codigo === 410) {
    // Drive guarda una subida a medias una semana; después hay que empezar de nuevo.
    borrarSubida_(id);
    throw errorCon_('La subida venció. La app la vuelve a mandar desde el principio.', { reiniciar: true });
  }
  throw new Error('Drive no recibió la parte (' + codigo + '). Reintento en un rato.');
}

function terminarGrabacion_(id, s, audioId) {
  if (!reunionPorId_(id)) {
    encolarReunion_({
      id: id,
      titulo: '',
      grabo: s.nombre,
      email: s.email,
      nota: s.nota,
      carpetaId: s.carpetaId,
      audioId: audioId,
      tipo: s.tipo,
    });
  }
  borrarSubida_(id);
  return { ok: true, recibidos: s.tamanio, terminada: true };
}

/** Para que la app muestre en qué va cada grabación y abra la minuta. */
function estadoDeGrabaciones_(quien, ids) {
  const pedidas = ids.map(String);
  const grabaciones = reuniones_().filter(function (r) {
    return r.email === quien.email && pedidas.indexOf(r.id) !== -1;
  }).map(function (r) {
    return {
      id: r.id,
      estado: r.estado,
      titulo: r.titulo,
      minuta: r.minutaUrl,
      error: r.estado === 'error' ? r.error : '',
    };
  });
  return { ok: true, grabaciones: grabaciones };
}
