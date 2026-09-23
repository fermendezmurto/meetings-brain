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
