/**
 * Asistente de tareas y reuniones para Google Chat.
 *
 * ARCHIVO GENERADO: no se edita a mano. La fuente está en asistente/src y se
 * vuelve a generar con: node scripts/armar-asistente.mjs
 */

// ===== Config.js =====

/**
 * Configuración. Lo que cambia entre instalaciones vive en las Propiedades del
 * script (Configuración del proyecto → Propiedades del script), no en el código:
 * así la clave de Gemini nunca queda escrita en un archivo.
 *
 *   GEMINI_API_KEY   obligatoria. La clave de aistudio.google.com.
 *   GEMINI_MODEL     opcional. Por defecto gemini-3.6-flash. Si Google retira un
 *                    modelo, el error dice cuál poner acá.
 *   GEMINI_MODEL_NOTAS  el modelo liviano que atiende Chat. Lo elige instalar()
 *                    entre los que Google ofrece a la clave.
 *   GEMINI_MODEL_RESPALDO opcional. El que se prueba cuando el de las reuniones
 *                    está saturado. Por defecto, el de notas; "ninguno" lo apaga.
 *   CARPETA_ID       la completa instalar().
 *   BASE_ID          la completa instalar().
 */

const ZONA = 'America/Asuncion';
const MODELO_POR_DEFECTO = 'gemini-3.6-flash';
/**
 * La variante liviana: más rápida, más barata y la que menos se satura. Es la
 * que atiende Chat, donde alguien espera la respuesta. Si instalar() no pudo
 * consultar la lista de Google, se usa esta.
 */
const LIVIANO_POR_DEFECTO = 'gemini-3.5-flash-lite';

/** Modelos para cada uso: el primero que se intenta y el de respaldo. */
function modelosPara_(uso) {
  const grande = prop_('GEMINI_MODEL', MODELO_POR_DEFECTO);
  const liviano = prop_('GEMINI_MODEL_NOTAS', LIVIANO_POR_DEFECTO);
  if (uso === 'nota') {
    return { principal: liviano, propiedad: 'GEMINI_MODEL_NOTAS', respaldo: modeloDeRespaldo(liviano, grande) };
  }
  return {
    principal: grande,
    propiedad: 'GEMINI_MODEL',
    respaldo: modeloDeRespaldo(grande, prop_('GEMINI_MODEL_RESPALDO', liviano)),
  };
}

/**
 * Hasta este tamaño un audio es una nota de voz y se contesta en el momento.
 * Más grande es una reunión y se procesa aparte: Chat corta la espera a los
 * 30 segundos y una reunión tarda más que eso.
 */
const LIMITE_NOTA_BYTES = 2.5 * 1024 * 1024;

/**
 * Apps Script no manda más de 50 MB por pedido. Con margen, 48 MB son entre 50
 * minutos y hora y media de grabación del teléfono, según la calidad.
 */
const LIMITE_AUDIO_BYTES = 48 * 1024 * 1024;

function prop_(clave, porDefecto) {
  const valor = PropertiesService.getScriptProperties().getProperty(clave);
  return valor ? String(valor).trim() : (porDefecto === undefined ? '' : porDefecto);
}

function exigirProp_(clave) {
  const valor = prop_(clave);
  if (!valor) {
    throw new Error('Falta ' + clave + ' en las Propiedades del script. ¿Corriste instalar()?');
  }
  return valor;
}

function hoy_() {
  return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
}

function ahora_() {
  return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd HH:mm');
}

// ===== Modelos.js =====

/**
 * Reglas sobre los modelos de Gemini que no dependen de Google Apps Script, para
 * poder probarlas afuera.
 */

/**
 * Cuánto se deja "pensar" al modelo antes de contestar. Importa porque Apps
 * Script corta cada pedido a los 60 segundos y Chat espera 30: un razonamiento
 * sin tope puede gastarse ese tiempo solo.
 *
 * Cada familia lo regula distinto. La 2.5 Flash acepta un presupuesto en
 * unidades; la 3 en adelante, un nivel. A un modelo que no se conoce no se le
 * manda nada, para no provocar un error.
 *
 * @param {number|undefined} presupuesto 0 para tareas mecánicas como
 *   transcribir; más para lo que requiere criterio, como una minuta.
 */
function configRazonamiento(modelo, presupuesto) {
  if (presupuesto === undefined || presupuesto === null) return null;
  if (/^gemini-2\.5-flash/.test(modelo)) return { thinkingBudget: presupuesto };
  if (/^gemini-([3-9]|\d{2,})/.test(modelo)) return { thinkingLevel: 'low' };
  return null;
}

/**
 * Google retira modelos cada tanto, y cuando lo hace el error dice cuál usar.
 * Se traduce a qué tocar, para que no haga falta cambiar código.
 */
function mensajeModeloRetirado(modelo, cuerpo, propiedad) {
  propiedad = propiedad || 'GEMINI_MODEL';
  const sugerido = (String(cuerpo).match(/use (?:models\/)?(gemini-[\w.-]*[\w])/i) || [])[1];
  return 'Google retiró el modelo ' + modelo + '. ' + (sugerido
    ? 'En Propiedades del script, poné ' + propiedad + ' = ' + sugerido + ' y volvé a probar.'
    : 'En Propiedades del script, cambiá ' + propiedad + ' por un modelo vigente.');
}

/**
 * Errores de Gemini que se arreglan solos esperando: saturación del modelo y
 * fallas momentáneas del servidor. Con el nivel gratuito y un modelo recién
 * lanzado son frecuentes, y no tienen que tratarse como si algo estuviera roto.
 */
function esErrorPasajero(codigo) {
  return codigo === 500 || codigo === 502 || codigo === 503 || codigo === 504;
}

/**
 * Cuánto tiene que quedar para que valga la pena otro intento: lo que tarda
 * Gemini en contestar una nota, más anotarla y agendarla, antes de que Chat
 * deje de esperar.
 */
const MARGEN_REINTENTO_MS = 10000;

/**
 * Cuántos pedidos como máximo. En el nivel gratuito la saturación es
 * intermitente: en la prueba real un pedido pasó y el siguiente no, así que
 * insistir unas veces alternando modelos rinde. Sin corte de tiempo, como en
 * las reuniones, se insiste menos: la próxima corrida vuelve a intentar.
 */
const MAX_PEDIDOS_CON_CORTE = 6;
const MAX_PEDIDOS_SIN_CORTE = 4;

/**
 * El modelo del intento número n (desde 0): se alternan los disponibles. Da
 * más chances que insistir con uno solo, porque cada uno tiene su capacidad.
 */
function modeloDelIntento(modelos, n) {
  return modelos[n % modelos.length];
}

/**
 * Se reintenta si el error es pasajero y queda tiempo. Lo que importa no es
 * cuánto tardó el primer intento sino cuánto falta para el corte: en la primera
 * prueba real, Google tardó en decir "saturado" y una regla basada en la
 * demora del primer intento dejó afuera justo ese caso.
 *
 * @param {number|undefined} restanteMs hasta el corte; sin corte, siempre hay tiempo
 */
function convieneReintentar(codigo, restanteMs) {
  if (!esErrorPasajero(codigo)) return false;
  return restanteMs === undefined || restanteMs > MARGEN_REINTENTO_MS;
}

/**
 * De la lista de modelos que devuelve Google, el liviano más nuevo: el que
 * mejor aguanta la saturación y el que alcanza para entender una nota. Se
 * prefieren las versiones estables a las de prueba.
 */
function elegirModeloLiviano(nombres) {
  const candidatos = nombres
    .map(function (n) { return String(n).replace(/^models\//, ''); })
    .map(function (n) {
      const m = n.match(/^gemini-(\d+(?:\.\d+)?)-flash-lite(-preview)?$/);
      return m ? { nombre: n, version: Number(m[1]), estable: !m[2] } : null;
    })
    .filter(function (x) { return x; });
  if (!candidatos.length) return '';
  candidatos.sort(function (a, b) {
    if (a.estable !== b.estable) return a.estable ? -1 : 1;
    return b.version - a.version;
  });
  return candidatos[0].nombre;
}

/**
 * El modelo a probar cuando el principal está saturado, o vacío si no hay.
 * No tiene sentido "respaldar" un modelo con él mismo.
 */
function modeloDeRespaldo(principal, configurado) {
  const r = String(configurado || '').trim();
  if (!r || r.toLowerCase() === 'ninguno' || r === principal) return '';
  return r;
}

// ===== Texto.js =====

/**
 * Nombres de personas: compararlos y encontrarlos como lo haria alguien de la
 * oficina. Sin dependencias de Google, para poder probarlo afuera.
 */

/**
 * "Fernando Méndez", "fernando mendez" y "  FERNANDO  MENDEZ " son la misma
 * persona. Sin esto la lista se llena de duplicados que nadie ve venir.
 */
function normalizarNombre(nombre) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca a alguien en la lista de la empresa a partir de como lo nombraron.
 *
 * En la oficina nadie dice el nombre completo: se dice "Diana". Si hay una sola
 * Diana, es ella. Si hay dos, no se adivina: se devuelven las candidatas para
 * preguntar. Asignarle una tarea a la persona equivocada es peor que no
 * asignarla.
 *
 * @return {{persona: Object|null, candidatos: Object[]}}
 */
function buscarPersona(personas, nombre) {
  const buscado = normalizarNombre(nombre);
  if (!buscado) return { persona: null, candidatos: [] };

  if (buscado.indexOf('@') !== -1) {
    const porCorreo = personas.filter(function (p) {
      return normalizarNombre(p.email) === buscado;
    });
    return { persona: porCorreo[0] || null, candidatos: porCorreo };
  }

  const exactas = personas.filter(function (p) {
    return normalizarNombre(p.nombre) === buscado;
  });
  if (exactas.length === 1) return { persona: exactas[0], candidatos: exactas };

  // "Diana" contra "Diana Valiente", o "Juan Antonio" contra "Juan Antonio Pérez":
  // coincide si lo dicho es el comienzo del nombre, palabra por palabra.
  const palabras = buscado.split(' ');
  const parciales = personas.filter(function (p) {
    const suyas = normalizarNombre(p.nombre).split(' ');
    return palabras.every(function (w, i) { return suyas[i] === w; });
  });
  if (parciales.length === 1) return { persona: parciales[0], candidatos: parciales };

  return { persona: null, candidatos: parciales.length ? parciales : exactas };
}

// ===== Fechas.js =====

/**
 * Fechas de vencimiento, dichas como se dicen en la oficina: "hoy", "mañana",
 * "vie 26/09". Trabaja con fechas AAAA-MM-DD sin hora, asi la zona horaria no
 * mueve un vencimiento de dia.
 */

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function esFechaIso(texto) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(texto || ''));
}

function diaDeLaSemana(fechaIso) {
  const p = fechaIso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

function diasEntre(desdeIso, hastaIso) {
  const a = desdeIso.split('-').map(Number);
  const b = hastaIso.split('-').map(Number);
  return Math.round(
    (Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000
  );
}

function fechaCorta(fechaIso) {
  const p = fechaIso.split('-');
  return DIAS_CORTOS[diaDeLaSemana(fechaIso)] + ' ' + p[2] + '/' + p[1];
}

/**
 * @return {string} '' si no hay plazo; 'hoy', 'mañana', 'vie 26/09', o
 *   'vencida: lun 22/09' cuando ya paso.
 */
function formatearPlazo(plazoIso, hoyIso) {
  if (!esFechaIso(plazoIso)) return '';
  const faltan = diasEntre(hoyIso, plazoIso);
  if (faltan < 0) return 'vencida: ' + fechaCorta(plazoIso);
  if (faltan === 0) return 'hoy';
  if (faltan === 1) return 'mañana';
  return fechaCorta(plazoIso);
}

/** "jueves 25/09/2026": lo que necesita el modelo para resolver "el viernes". */
function fechaParaElModelo(hoyIso) {
  const p = hoyIso.split('-');
  return DIAS_LARGOS[diaDeLaSemana(hoyIso)] + ' ' + p[2] + '/' + p[1] + '/' + p[0];
}

/** "mañana 17:00", "vie 26/09", "hoy". La hora se agrega si la hay. */
function formatearCuando(plazoIso, hora, hoyIso) {
  const dia = formatearPlazo(plazoIso, hoyIso);
  if (!dia) return '';
  return esHora(hora) ? dia + ' ' + normalizarHora(hora) : dia;
}

// ===== Agenda.js =====

/**
 * Qué va al calendario y qué va a Google Tasks. Sin dependencias de Google,
 * para poder probarlo afuera.
 *
 * Un evento ocurre en un momento: una reunión, una llamada, algo con hora. Una
 * tarea es algo que alguien tiene que hacer para una fecha. La diferencia
 * importa porque cada una va a donde la persona la va a mirar: los eventos al
 * calendario, las tareas a su lista.
 */

/** "17:00", "9:30". */
function esHora(texto) {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(texto || ''));
}

/** Siempre con dos dígitos: "9:30" pasa a "09:30". */
function normalizarHora(texto) {
  if (!esHora(texto)) return '';
  const p = String(texto).split(':');
  return (p[0].length === 1 ? '0' : '') + p[0] + ':' + p[1];
}

/**
 * Sin fecha no hay dónde poner un evento en el calendario: queda como tarea.
 * Con fecha, es evento si el modelo dijo que lo es o si se dijo una hora
 * ("recordame llamar al banco el lunes a las 10" es un momento, no un plazo).
 */
function clasificarItem(item) {
  if (!esFechaIso(item.plazo)) return 'tarea';
  if (item.tipo === 'evento' || esHora(item.hora)) return 'evento';
  return 'tarea';
}

/** Un evento cuyo día ya pasó no está pendiente: ya ocurrió. */
function yaOcurrio(t, hoy) {
  return t.tipo === 'evento' && esFechaIso(t.plazo) && t.plazo < hoy;
}

/**
 * Qué hay que hacer para que la base y el Google Tasks de una persona digan lo
 * mismo. Se decide acá y se ejecuta afuera, así la regla se puede probar.
 *
 * @param {Object[]} suyas   tareas de la base de las que la persona es responsable
 * @param {Object}   enTasks estado en su Google Tasks, por id: 'needsAction' | 'completed'
 * @return {{crear: Object[], cerrarEnBase: Object[], completarEnTasks: Object[]}}
 */
function planDeSincronizacion(suyas, enTasks) {
  const plan = { crear: [], cerrarEnBase: [], completarEnTasks: [] };
  suyas.forEach(function (t) {
    if (t.tipo === 'evento') return;
    const estado = t.idTasks ? enTasks[t.idTasks] : undefined;
    if (t.estado === 'abierta') {
      // Si la persona la borró de su lista, no se vuelve a crear: sería
      // insistirle con algo que sacó a propósito. Sigue en la base y en el
      // resumen de la mañana.
      if (!t.idTasks) plan.crear.push(t);
      else if (estado === 'completed') plan.cerrarEnBase.push(t);
    } else if (t.idTasks && estado === 'needsAction') {
      plan.completarEnTasks.push(t);
    }
  });
  return plan;
}

// ===== Intencion.js =====

/**
 * Los pedidos que se entienden sin llamar al modelo. Son los de todos los dias
 * ("pendientes", "listo 4"): resolverlos aca es instantaneo, no gasta cuota de
 * Gemini y nunca se equivoca.
 *
 * Todo lo que no calza aca se lo pasa a Gemini como mensaje libre.
 */
function interpretarComando(texto) {
  const t = String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.]/g, '')
    .replace(/^\//, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!t) return { tipo: 'vacio' };

  if (/^(ayuda|help|hola|comandos|que podes hacer|como funciona)$/.test(t)) {
    return { tipo: 'ayuda' };
  }
  if (/^(pendientes|mis pendientes|tareas|mis tareas|que tengo|que tengo pendiente|que tengo que hacer|que me toca)$/.test(t)) {
    return { tipo: 'pendientes' };
  }
  if (/^(pedidos|mis pedidos|lo que pedi|que pedi|que pedi yo|lo que encargue)$/.test(t)) {
    return { tipo: 'pedidos' };
  }

  const cierre = t.match(/^(listo|lista|hecho|hecha|cerrar|cerrada|terminado|terminada|ok)\s*(?:la\s+)?#?\s*(\d+)$/);
  if (cierre) return { tipo: 'cerrar', numero: Number(cierre[2]) };

  return { tipo: 'libre', texto: String(texto).trim() };
}

// ===== Eventos.js =====

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

// ===== Prompts.js =====

/**
 * Lo que se le pide a Gemini y la forma exacta en que tiene que contestar.
 *
 * Los esquemas no son decorativos: sin ellos el modelo contesta en prosa y no
 * hay de donde sacar las tareas. Los tipos van en mayusculas porque asi los
 * documenta la API de Gemini.
 */

const ESQUEMA_NOTA = {
  type: 'OBJECT',
  properties: {
    intencion: { type: 'STRING', enum: ['anotar', 'pendientes', 'pedidos', 'otra'] },
    tareas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tipo: { type: 'STRING', enum: ['tarea', 'evento'] },
          que: { type: 'STRING' },
          responsable: { type: 'STRING' },
          plazo: { type: 'STRING' },
          hora: { type: 'STRING' },
          duracionMinutos: { type: 'INTEGER' },
          participantes: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['tipo', 'que'],
      },
    },
    respuesta: { type: 'STRING' },
  },
  required: ['intencion', 'tareas', 'respuesta'],
};

/**
 * Para notas de voz y mensajes sueltos: "pedile a Diana el presupuesto para el
 * viernes", "recordame llamar al estudio", "¿qué tengo pendiente?".
 */
function promptNota(ctx) {
  const conocidas = ctx.personas.length
    ? 'Personas de la empresa: ' + ctx.personas.join(', ') + '.'
    : 'Todavía no hay una lista de personas de la empresa.';

  const mensaje = ctx.texto
    ? 'Mensaje de ' + ctx.quien + ':\n' + ctx.texto
    : ctx.quien + ' te mandó el audio adjunto.';

  return [
    'Sos el asistente de tareas de una empresa de Paraguay. Tu trabajo es anotar',
    'lo que alguien tiene que hacer, sin inventar nada.',
    '',
    'Hoy es ' + ctx.hoyLargo + ' (' + ctx.hoy + ').',
    conocidas,
    '',
    mensaje,
    '',
    'Decidí la intención:',
    '- "anotar": pide registrar algo que alguien tiene que hacer.',
    '- "pendientes": pregunta qué tiene pendiente.',
    '- "pedidos": pregunta por lo que les pidió a otros.',
    '- "otra": nada de lo anterior.',
    '',
    'Si la intención es "anotar", completá la lista "tareas", una entrada por cada cosa:',
    '- "tipo": "evento" si es algo que ocurre en un momento: una reunión, una llamada,',
    '  una visita, o cualquier cosa con hora. "tarea" si es algo que alguien tiene que',
    '  hacer para una fecha, aunque no tenga hora.',
    '- "que": breve. Para una tarea, empezando con un verbo ("Enviar el presupuesto").',
    '  Para un evento, lo que es ("Reunión con Rony", "Llamada al banco").',
    '- "responsable": quién la tiene que hacer. Si coincide con alguien de la lista,',
    '  usá el nombre exactamente como figura en la lista. Si ' + ctx.quien + ' habla de sí',
    '  mismo ("tengo que", "recordame", "me toca"), el responsable es ' + ctx.quien + '.',
    '  Si no se sabe, dejalo vacío.',
    '- "plazo": fecha AAAA-MM-DD. Resolvé "el viernes", "mañana", "fin de mes" contra',
    '  la fecha de hoy. Si no se dijo ninguna fecha, dejalo vacío: no inventes plazos.',
    '- "hora": HH:MM en 24 horas si se dijo ("5 de la tarde" es "17:00"). Vacía si no.',
    '- "duracionMinutos": solo si se dijo cuánto dura.',
    '- "participantes": en un evento, quiénes más van a estar, con el nombre como',
    '  figura en la lista si coincide. No incluyas a quien habla.',
    '',
    '"respuesta": una sola frase corta confirmando lo que entendiste, de vos, sin',
    'emojis ni exclamaciones. Si el audio no se entiende, decilo.',
  ].join('\n');
}

/**
 * Apps Script corta cualquier pedido a los 60 segundos, y lo que tarda en un
 * modelo es escribir mucho texto. Por eso una reunión no se transcribe de una
 * vez: primero sale la minuta, que es corta, y después la transcripción en
 * tramos de pocos minutos, pidiendo cada uno por su marca de tiempo.
 */
const MINUTOS_POR_TRAMO = 10;

const ESQUEMA_MINUTA = {
  type: 'OBJECT',
  properties: {
    titulo: { type: 'STRING' },
    resumen: { type: 'STRING' },
    duracionMinutos: { type: 'INTEGER' },
    participantes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { nombre: { type: 'STRING' }, rol: { type: 'STRING' } },
        required: ['nombre'],
      },
    },
    decisiones: { type: 'ARRAY', items: { type: 'STRING' } },
    compromisos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          que: { type: 'STRING' },
          responsable: { type: 'STRING' },
          plazo: { type: 'STRING' },
        },
        required: ['que'],
      },
    },
    preguntasAbiertas: { type: 'ARRAY', items: { type: 'STRING' } },
    riesgos: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['titulo', 'resumen', 'participantes', 'decisiones', 'compromisos'],
};

/** La minuta, escuchando el audio completo. */
function promptMinuta(ctx) {
  const lineas = [
    'Escuchá la reunión adjunta, de una empresa de Paraguay, y escribí su minuta.',
    '',
    'Fecha de la reunión: ' + ctx.fechaLargo + ' (' + ctx.fecha + ').',
    'La grabó ' + ctx.quien + '.',
  ];
  if (ctx.nota) lineas.push('Lo que escribió al mandar el audio: "' + ctx.nota + '"');
  if (ctx.personas.length) lineas.push('Personas de la empresa: ' + ctx.personas.join(', ') + '.');

  return lineas.concat([
    '',
    '- "participantes": quiénes hablaron. Deducilo de lo que se dice: se nombran,',
    '  se saludan, se asignan trabajo. Usá el nombre como figura en la lista si',
    '  coincide. Si no se puede saber quién es una voz, no la inventes: dejala afuera.',
    '- "titulo": corto y concreto, sin la fecha.',
    '- "resumen": de tres a seis frases, sin adjetivos de relleno.',
    '- "duracionMinutos": cuánto dura el audio, en minutos.',
    '- "decisiones": solo lo que quedó resuelto, no lo que se propuso.',
    '- "compromisos": trabajo que alguien se llevó. "responsable" con el nombre como',
    '  figura en la lista si coincide. "plazo" en AAAA-MM-DD, resolviendo fechas',
    '  relativas contra la fecha de la reunión; vacío si no se dijo.',
    '- "preguntasAbiertas": lo que quedó sin responder.',
    '- "riesgos": lo que puede salir mal y se mencionó.',
    '',
    'No inventes nada que no se haya dicho.',
  ]).join('\n');
}

const ESQUEMA_TRAMO = {
  type: 'OBJECT',
  properties: {
    turnos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          desde: { type: 'NUMBER' },
          quien: { type: 'STRING' },
          texto: { type: 'STRING' },
        },
        required: ['desde', 'quien', 'texto'],
      },
    },
  },
  required: ['turnos'],
};

/** "05:00", "1:10:00": como Gemini entiende las marcas de tiempo de un audio. */
function marcaDeTiempo(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  const dos = (m < 10 ? '0' : '') + m;
  return h > 0 ? h + ':' + dos + ':00' : dos + ':00';
}

/** Un tramo de la transcripción literal. */
function promptTramo(ctx) {
  const nombres = ctx.participantes.length
    ? 'Participantes de la reunión: ' + ctx.participantes.join(', ') + '. Usá esos nombres cuando reconozcas a quien habla.'
    : '';
  return [
    'Transcribí literal SOLO lo que se dice en el audio adjunto entre ' + marcaDeTiempo(ctx.desde) +
      ' y ' + marcaDeTiempo(ctx.hasta) + '. Es una reunión de trabajo en español de Paraguay.',
    nombres,
    '',
    '- Un turno por cada vez que cambia la voz.',
    '- "desde": segundos desde el inicio del audio completo, no del tramo.',
    '- "quien": el nombre si lo reconocés; si no, "Hablante 1", "Hablante 2"...',
    '- Literal y con puntuación. No resumas ni corrijas. Nombres, montos y fechas tal como suenan.',
    '- Si un tramo es inaudible, escribí [inaudible].',
    '- Si en ese rango no se dice nada, o el audio ya terminó, devolvé la lista de turnos vacía.',
  ].filter(function (l, i) { return l !== '' || i > 0; }).join('\n');
}

/**
 * Cuánto dura el audio, según lo que cobró Gemini: cuenta 32 unidades por
 * segundo de audio. Es más confiable que preguntárselo al modelo.
 */
function minutosDeAudio(uso) {
  const detalle = ((uso || {}).promptTokensDetails || []).filter(function (d) {
    return d.modality === 'AUDIO';
  })[0];
  if (!detalle || !detalle.tokenCount) return 0;
  return Math.ceil(detalle.tokenCount / 32 / 60);
}

// ===== Formato.js =====

/**
 * Lo que el Asistente escribe en Chat. Corto, sin adornos, y siempre con el
 * numero de cada tarea, que es lo que la gente usa para cerrarla ("listo 12").
 *
 * En Google Chat el negrito va entre asteriscos simples.
 */

function textoAyuda() {
  return [
    '*Qué podés hacer conmigo*',
    '',
    '• *Anotar algo:* escribime o mandame un audio. "Pedile a Diana el presupuesto para el viernes", "recordame llamar al estudio mañana".',
    '• *Una reunión:* grabala con la grabadora del teléfono y mandame el audio. Si querés, escribí con quién era. Te aviso cuando esté la minuta.',
    '• *pendientes:* lo que tenés que hacer vos.',
    '• *pedidos:* lo que les pediste a otros.',
    '• *listo 12:* cierra la tarea 12.',
  ].join('\n');
}

function textoBienvenida(nombre) {
  return [
    'Hola, ' + nombre + '. Soy el Asistente: anoto tareas, reparto pedidos y armo las minutas de las reuniones.',
    '',
    textoAyuda(),
    '',
    '_Estamos en piloto: no me mandes todavía nada confidencial._',
  ].join('\n');
}

/** Una tarea en una línea: "#12 Enviar el presupuesto — Diana · vie 26/09". */
function lineaTarea(t, hoy, mostrarResponsable) {
  const plazo = formatearCuando(t.plazo, t.hora, hoy);
  let linea = '*#' + t.numero + '* ' + t.que;
  if (mostrarResponsable) linea += ' — ' + (t.responsable || 'sin responsable');
  if (plazo) linea += ' · ' + (plazo.indexOf('vencida') === 0 ? '*' + plazo + '*' : plazo);
  return linea;
}

/**
 * Las vencidas y las de fecha más cercana arriba; las sin fecha al final.
 * Es el orden en que alguien las tiene que mirar.
 */
function ordenarPorPlazo(tareas) {
  return tareas.slice().sort(function (a, b) {
    const pa = esFechaIso(a.plazo) ? a.plazo : '9999-99-99';
    const pb = esFechaIso(b.plazo) ? b.plazo : '9999-99-99';
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.numero - b.numero;
  });
}

function listarPendientes(tareas, hoy) {
  if (!tareas.length) return 'No tenés nada pendiente.';
  return ['*Tus pendientes*', '']
    .concat(ordenarPorPlazo(tareas).map(function (t) { return '• ' + lineaTarea(t, hoy, false); }))
    .concat(['', 'Cuando termines una, escribime *listo* y el número.'])
    .join('\n');
}

function listarPedidos(tareas, hoy) {
  if (!tareas.length) return 'No tenés pedidos abiertos a otras personas.';
  return ['*Lo que pediste y sigue abierto*', '']
    .concat(ordenarPorPlazo(tareas).map(function (t) { return '• ' + lineaTarea(t, hoy, true); }))
    .join('\n');
}

/**
 * La confirmación después de anotar. Dice explícitamente a quién no se le pudo
 * avisar y por qué: una tarea que el responsable no se enteró que tiene es una
 * tarea que no existe.
 */
function confirmarAnotadas(respuesta, anotadas, hoy) {
  const lineas = [respuesta, ''];
  anotadas.forEach(function (a) {
    lineas.push('• ' + lineaTarea(a.tarea, hoy, true));
    if (a.nota) lineas.push('   ' + a.nota);
    if (a.problema) lineas.push('   ' + a.problema);
  });
  return lineas.join('\n').trim();
}

function reloj(segundos) {
  const s = Math.max(0, Math.round(Number(segundos) || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const dos = function (n) { return (n < 10 ? '0' : '') + n; };
  return hh > 0 ? hh + ':' + dos(mm) + ':' + dos(ss) : dos(mm) + ':' + dos(ss);
}

/** Turnos de la transcripción en texto, con minuto y nombre. */
function renderizarTurnos(turnos) {
  return (turnos || []).map(function (t) {
    return '[' + reloj(t.desde) + '] ' + (t.quien || 'Sin identificar') + ': ' + t.texto;
  }).join('\n');
}

/**
 * Las secciones de la minuta en orden. La usan el documento de Drive y el
 * correo, para que digan exactamente lo mismo.
 */
function seccionesMinuta(m) {
  return [
    { titulo: 'Participantes', items: (m.participantes || []).map(function (p) { return p.nombre + (p.rol ? ' (' + p.rol + ')' : ''); }), vacio: 'Sin identificar' },
    { titulo: 'Decisiones', items: m.decisiones || [], vacio: 'No se cerró ninguna decisión' },
    {
      titulo: 'Compromisos',
      items: (m.compromisos || []).map(function (c) {
        return c.que + ' — ' + (c.responsable || 'sin responsable') + (esFechaIso(c.plazo) ? ', para el ' + fechaCorta(c.plazo) : ', sin plazo');
      }),
      vacio: 'Nadie se llevó trabajo',
    },
    { titulo: 'Preguntas abiertas', items: m.preguntasAbiertas || [], vacio: 'Ninguna' },
    { titulo: 'Riesgos', items: m.riesgos || [], vacio: 'Ninguno mencionado' },
  ];
}

/**
 * La minuta en la forma estable que puede leer otro sistema. Si cambia, se
 * sube "version" y se documenta en asistente/DATOS.md.
 */
function datosDeMinuta(r, m, fecha, duracion, enlaces, anotadas) {
  return {
    version: 1,
    tipo: 'minuta',
    id: r.id,
    fecha: fecha,
    recibida: r.recibida,
    titulo: m.titulo || '',
    grabo: { nombre: r.grabo, email: r.email },
    nota: r.nota || '',
    duracionMinutos: duracion,
    resumen: m.resumen || '',
    participantes: (m.participantes || []).map(function (p) {
      return { nombre: p.nombre, rol: p.rol || '' };
    }),
    decisiones: m.decisiones || [],
    compromisos: anotadas.map(function (a) {
      return {
        tarea: a.tarea.numero,
        que: a.tarea.que,
        responsable: a.tarea.responsable || '',
        email: a.tarea.emailResponsable || '',
        plazo: a.tarea.plazo || '',
      };
    }),
    preguntasAbiertas: m.preguntasAbiertas || [],
    riesgos: m.riesgos || [],
    enlaces: enlaces,
  };
}

// ===== Base.js =====

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

// ===== Gemini.js =====

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

  const turno = [modelo].concat(modelos.respaldo ? [modelos.respaldo] : []);
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
  const r = pedirGemini_(modelo, partes, generacionPara_(modelo, esquema, opciones));
  if (r.getResponseCode() === 400 && configRazonamiento(modelo, opciones.razonamiento) &&
      /thinking/i.test(r.getContentText())) {
    return pedirGemini_(modelo, partes, generacionPara_(modelo, esquema, { maxTokens: opciones.maxTokens }));
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

// ===== Google.js =====

/**
 * Calendar y Google Tasks.
 *
 * Todo corre con la cuenta de quien está usando el Asistente en ese momento:
 * su calendario y su lista de tareas. Google no deja escribir en la lista de
 * otra persona sin un permiso del administrador; por eso una tarea para Diana
 * aparece en su Google Tasks la próxima vez que ella le escribe al Asistente,
 * que es cuando el Asistente corre con la cuenta de ella.
 */

function usuarioActual_() {
  return String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
}

/**
 * El evento va al calendario de quien lo pidió, con invitación a los demás:
 * la invitación es la forma en que Google pone un evento en el calendario de
 * otra persona sin permisos especiales.
 */
function crearEvento_(t, invitados, duracionMinutos) {
  const opciones = {
    description: 'Anotado por el Asistente (#' + t.numero + '), a pedido de ' + t.pidio + '.' +
      (t.enlace ? '\n' + t.enlace : ''),
  };
  if (invitados.length) {
    opciones.guests = invitados.join(',');
    opciones.sendInvites = true;
  }
  const calendario = CalendarApp.getDefaultCalendar();
  let evento;
  if (esHora(t.hora)) {
    const inicio = Utilities.parseDate(t.plazo + ' ' + normalizarHora(t.hora), ZONA, 'yyyy-MM-dd HH:mm');
    const fin = new Date(inicio.getTime() + (Number(duracionMinutos) || 60) * 60000);
    evento = calendario.createEvent(t.que, inicio, fin, opciones);
  } else {
    evento = calendario.createAllDayEvent(t.que, Utilities.parseDate(t.plazo, ZONA, 'yyyy-MM-dd'), opciones);
  }
  return evento.getId();
}

function crearGoogleTask_(t) {
  const tarea = {
    title: t.que,
    notes: 'Tarea #' + t.numero + ' del Asistente, pedida por ' + t.pidio + '.' +
      (t.enlace ? '\n' + t.enlace : '') +
      '\nMarcarla como hecha acá la cierra también en el Asistente.',
  };
  // Google Tasks guarda solo el día: la hora de la fecha se ignora.
  if (esFechaIso(t.plazo)) tarea.due = t.plazo + 'T00:00:00.000Z';
  return Tasks.Tasks.insert(tarea, '@default').id;
}

/** Estado de cada tarea de la lista de la persona, por id. */
function estadoEnTasks_() {
  const estado = {};
  let pagina;
  do {
    const r = Tasks.Tasks.list('@default', {
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
      pageToken: pagina,
    });
    (r.items || []).forEach(function (x) { estado[x.id] = x.status; });
    pagina = r.nextPageToken;
  } while (pagina);
  return estado;
}

function completarEnTasks_(id) {
  Tasks.Tasks.patch({ status: 'completed' }, '@default', id);
}

/**
 * Deja la base y el Google Tasks de la persona diciendo lo mismo, en los dos
 * sentidos: crea en su lista lo que tiene pendiente, cierra en la base lo que
 * marcó como hecho allá, y marca como hecho allá lo que se cerró por Chat.
 *
 * Nunca rompe: si Google Tasks falla, el Asistente sigue funcionando y se
 * vuelve a intentar en la próxima conversación.
 */
function sincronizarGoogleTasks_(email) {
  try {
    const suyas = tareasDeResponsable_(email).filter(function (t) { return t.tipo !== 'evento'; });
    const hayQueCrear = suyas.some(function (t) { return t.estado === 'abierta' && !t.idTasks; });
    const hayQueMirar = suyas.some(function (t) { return t.idTasks; });
    if (!hayQueCrear && !hayQueMirar) return;

    const plan = planDeSincronizacion(suyas, hayQueMirar ? estadoEnTasks_() : {});
    plan.crear.forEach(function (t) { actualizarTarea_(t, { idTasks: crearGoogleTask_(t) }); });
    plan.completarEnTasks.forEach(function (t) { completarEnTasks_(t.idTasks); });
    plan.cerrarEnBase.forEach(function (t) {
      actualizarTarea_(t, { estado: 'cerrada', cerrada: ahora_() });
      if (t.emailPidio && t.emailPidio !== email) avisarCierre_(t, { nombre: t.responsable });
    });
  } catch (err) {
    console.error('Sincronización con Google Tasks de ' + email + ': ' + (err && err.stack ? err.stack : err));
  }
}

// ===== Avisos.js =====

/**
 * Los correos del Asistente.
 *
 * Los que salen de una conversación en Chat se mandan con la cuenta de quien
 * escribió: si Fernando le pide algo a Diana, el correo le llega a Diana de
 * parte de Fernando, que es lo que pasó. Los que salen del procesamiento de
 * reuniones y del resumen de la mañana, con la cuenta de quien instaló.
 */

function sinFormatoChat_(texto) {
  return String(texto).replace(/\*/g, '').replace(/_/g, '');
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

// ===== Chat.js =====

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

// ===== Reuniones.js =====

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
  }], ESQUEMA_MINUTA, { uso: 'reunion', razonamiento: 1024 });
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
  }], ESQUEMA_TRAMO, { uso: 'reunion', razonamiento: 0, maxTokens: 16384 });

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

// ===== Instalar.js =====

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
    if (f === 'procesarReuniones' || f === 'avisoMatutino') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('procesarReuniones').timeBased().everyMinutes(5).create();
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
