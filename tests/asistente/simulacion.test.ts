import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { armar } from '../../scripts/armar-asistente.mjs'
import { crearGoogle, mensaje } from './google-falso'

/**
 * El Asistente de punta a punta contra una imitación de Google: instalarlo,
 * escribirle, mandarle notas de voz y reuniones, cerrar tareas y recibir el
 * resumen de la mañana. Es lo más cerca de usarlo de verdad que se puede llegar
 * sin conexión.
 */

// Viernes 25 de septiembre de 2026, 10:00 en Asunción.
const AHORA = '2026-09-25T13:00:00Z'

const FER = { nombre: 'Fernando Méndez', email: 'fernando@empresa.com' }
const DIANA = { nombre: 'Diana Valiente', email: 'diana@empresa.com' }
const CHRISTIAN = { nombre: 'Christian Aponte', email: 'christian@empresa.com' }

describe('el archivo para pegar en Apps Script', () => {
  it('está al día con las fuentes', () => {
    // Si esto falla: node scripts/armar-asistente.mjs
    const pegado = readFileSync(path.join(__dirname, '../../asistente/dist/Asistente.gs'), 'utf8')
    expect(pegado === armar(), 'asistente/dist/Asistente.gs quedó viejo').toBe(true)
  })
})

function instalado(guion = {}) {
  const g = crearGoogle({ ahora: AHORA, guion })
  g.props.set('GEMINI_API_KEY', 'AQ.clave-de-prueba')
  g.llamar('instalar')
  return g
}

const escribir = (g: any, quien: any, texto: string, adjuntos: any[] = []) =>
  g.llamar('onMessage', mensaje(quien, texto, adjuntos)).text as string

describe('instalar', () => {
  it('arma la carpeta, la base y las tareas automáticas, y prueba la clave', () => {
    const g = instalado()
    expect(g.props.get('CARPETA_ID')).toBeTruthy()
    expect(g.props.get('BASE_ID')).toBeTruthy()
    expect(g.hoja('Tareas')[0]).toContain('Plazo')
    expect(g.hoja('Personas')[0]).toEqual(['Nombre', 'Email', 'Última vez'])
    expect(g.disparadores.map((t: any) => t.funcion).sort()).toEqual(['avisoMatutino', 'procesarReuniones'])
    expect(g.pedidosGemini.at(-1)!.tipo).toBe('prueba')
  })

  it('se puede correr dos veces sin duplicar nada', () => {
    const g = instalado()
    const base = g.props.get('BASE_ID')
    g.llamar('instalar')
    expect(g.props.get('BASE_ID')).toBe(base)
    expect(g.disparadores).toHaveLength(2)
  })

  it('sin la clave de Gemini se niega y dice qué falta', () => {
    const g = crearGoogle({ ahora: AHORA })
    expect(() => g.llamar('instalar')).toThrow(/GEMINI_API_KEY/)
  })

  it('si Google retiró el modelo, dice exactamente qué propiedad cambiar', () => {
    const g = crearGoogle({ ahora: AHORA, guion: { modelosRetirados: ['gemini-2.5-flash'] } })
    g.props.set('GEMINI_API_KEY', 'AQ.x')
    g.props.set('GEMINI_MODEL', 'gemini-2.5-flash')
    expect(() => g.llamar('instalar')).toThrow('poné GEMINI_MODEL = gemini-3.6-flash')
    // Con la propiedad corregida, se instala sin tocar el código.
    g.props.set('GEMINI_MODEL', 'gemini-3.6-flash')
    expect(() => g.llamar('instalar')).not.toThrow()
  })

  it('usa el modelo que diga la propiedad, y le acota el razonamiento a su manera', () => {
    const g = instalado({ nota: { intencion: 'pendientes', respuesta: '', tareas: [] } })
    g.props.set('GEMINI_MODEL', 'gemini-2.5-flash')
    escribir(g, FER, 'anotame algo')
    const pedido = g.pedidosGemini.at(-1)!
    expect(pedido.url).toContain('models/gemini-2.5-flash:')
    expect(pedido.cuerpo.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 512 })
  })

  it('si el modelo no acepta cómo se acota el razonamiento, pide de nuevo sin acotarlo', () => {
    const g = instalado({ rechazaRazonamiento: true, nota: { intencion: 'pendientes', respuesta: '', tareas: [] } })
    expect(escribir(g, FER, 'anotame algo')).toBe('No tenés nada pendiente.')
    const ultimos = g.pedidosGemini.slice(-2)
    expect(ultimos[0].cuerpo.generationConfig.thinkingConfig).toBeTruthy()
    expect(ultimos[1].cuerpo.generationConfig.thinkingConfig).toBeUndefined()
  })

  it('manda la clave en un encabezado, nunca en la dirección', () => {
    const g = instalado()
    expect(g.pedidosGemini.every((p) => p.claveEnEncabezado && !p.url.includes('key='))).toBe(true)
  })
})

describe('conversación', () => {
  it('saluda al que lo agrega y lo suma a la lista de la empresa', () => {
    const g = instalado()
    const r = g.llamar('onAddedToSpace', { ...mensaje(FER, ''), type: 'ADDED_TO_SPACE' })
    expect(r.text).toContain('Hola, Fernando')
    expect(r.text).toContain('piloto')
    expect(g.hoja('Personas')[1].slice(0, 2)).toEqual(['Fernando Méndez', 'fernando@empresa.com'])
  })

  it('"pendientes" y "ayuda" se contestan sin gastar un pedido de Gemini', () => {
    const g = instalado()
    const antes = g.pedidosGemini.length
    expect(escribir(g, FER, 'ayuda')).toContain('Qué podés hacer conmigo')
    expect(escribir(g, FER, '¿Qué tengo pendiente?')).toBe('No tenés nada pendiente.')
    expect(g.pedidosGemini.length).toBe(antes)
  })

  it('anota un pedido, se lo asigna a la persona correcta y le avisa de parte de quien lo pidió', () => {
    const g = instalado({
      nota: { intencion: 'anotar', respuesta: 'Le anoto a Diana el presupuesto.', tareas: [{ que: 'Enviar el presupuesto', responsable: 'Diana', plazo: '2026-09-29' }] },
    })
    escribir(g, DIANA, 'hola') // Diana ya le escribió una vez: el Asistente la conoce.
    const r = escribir(g, FER, 'Pedile a Diana el presupuesto para el martes')

    expect(r).toContain('*#1* Enviar el presupuesto — Diana Valiente · mar 29/09')

    const fila = g.hoja('Tareas')[1]
    expect(fila[3]).toBe('Diana Valiente')
    expect(fila[4]).toBe('diana@empresa.com')
    // El plazo sigue siendo texto: Sheets no lo convirtió en fecha con hora.
    expect(fila[5]).toBe('2026-09-29')

    const correo = g.correos.at(-1)
    expect(correo.to).toBe('diana@empresa.com')
    expect(correo.name).toBe('Fernando Méndez (vía Asistente)')
    expect(correo.body).toContain('listo 1')

    // Al modelo se le dio la fecha y la lista de gente: sin eso no puede resolver nada.
    const prompt = g.pedidosGemini.at(-1)!.cuerpo.contents[0].parts.at(-1).text
    expect(prompt).toContain('viernes 25/09/2026')
    expect(prompt).toContain('Diana Valiente')
  })

  it('"recordame" es para quien habla, y no se manda un correo a sí mismo', () => {
    const g = instalado({
      nota: { intencion: 'anotar', respuesta: 'Te lo anoto.', tareas: [{ que: 'Llamar al estudio', responsable: '', plazo: '' }] },
    })
    const r = escribir(g, FER, 'recordame llamar al estudio')
    expect(r).toContain('Llamar al estudio — Fernando Méndez')
    expect(g.correos).toHaveLength(0)
    expect(escribir(g, FER, 'pendientes')).toContain('Llamar al estudio')
  })

  it('si no conoce a la persona, anota igual pero dice que no pudo avisar', () => {
    const g = instalado({
      nota: { intencion: 'anotar', respuesta: 'Anotado.', tareas: [{ que: 'Revisar el contrato', responsable: 'Rodolfo', plazo: '' }] },
    })
    const r = escribir(g, FER, 'que Rodolfo revise el contrato')
    expect(r).toContain('Todavía no conozco a "Rodolfo"')
    expect(g.correos).toHaveLength(0)
  })

  it('si dos personas coinciden, no adivina', () => {
    const g = instalado({
      nota: { intencion: 'anotar', respuesta: 'Anotado.', tareas: [{ que: 'Mandar la propuesta', responsable: 'Juan', plazo: '' }] },
    })
    escribir(g, { nombre: 'Juan Antonio Pérez', email: 'ja@empresa.com' }, 'hola')
    escribir(g, { nombre: 'Juan Martín Gómez', email: 'jm@empresa.com' }, 'hola')
    const r = escribir(g, FER, 'que Juan mande la propuesta')
    expect(r).toContain('Hay más de una persona que coincide con "Juan"')
    expect(g.correos).toHaveLength(0)
  })

  it('solo cierra una tarea quien la tiene o quien la pidió, y le avisa al que pidió', () => {
    const g = instalado({
      nota: { intencion: 'anotar', respuesta: 'Anotado.', tareas: [{ que: 'Enviar el presupuesto', responsable: 'Diana', plazo: '' }] },
    })
    escribir(g, DIANA, 'hola')
    escribir(g, FER, 'pedile a Diana el presupuesto')
    g.correos.length = 0

    expect(escribir(g, CHRISTIAN, 'listo 1')).toContain('no es tuya ni la pediste vos')
    expect(escribir(g, DIANA, 'listo 1')).toBe('Cerrada la *#1* Enviar el presupuesto. Le avisé a Fernando.')
    expect(g.correos.at(-1).to).toBe('fernando@empresa.com')
    expect(escribir(g, DIANA, 'listo 1')).toContain('ya estaba cerrada')
    expect(escribir(g, FER, 'listo 99')).toContain('No existe la tarea #99')
  })

  it('"pedidos" muestra lo que uno encargó a otros y sigue abierto', () => {
    const g = instalado({
      nota: { intencion: 'anotar', respuesta: 'Anotado.', tareas: [{ que: 'Enviar el presupuesto', responsable: 'Diana', plazo: '2026-09-24' }] },
    })
    escribir(g, DIANA, 'hola')
    escribir(g, FER, 'pedile a Diana el presupuesto')
    const r = escribir(g, FER, 'pedidos')
    expect(r).toContain('Enviar el presupuesto — Diana Valiente · *vencida: jue 24/09*')
  })

  it('un error de Gemini llega como mensaje claro, no como silencio', () => {
    const g = instalado({ fallaGemini: (t: string) => (t === 'nota' ? 429 : undefined) })
    expect(escribir(g, FER, 'anotame algo')).toContain('límite de pedidos del nivel gratuito')
  })

  it('contesta en el formato nuevo de Google cuando llega en ese formato', () => {
    const g = instalado()
    const r = g.llamar('onMessage', {
      chat: { user: { displayName: FER.nombre, email: FER.email }, messagePayload: { message: { text: 'ayuda' }, space: {} } },
    })
    expect(r.hostAppDataAction.chatDataAction.createMessageAction.message.text).toContain('Qué podés hacer conmigo')
  })
})

describe('notas de voz', () => {
  it('un audio corto se entiende en el momento, mandado dentro del mismo pedido', () => {
    const g = instalado({
      nota: { intencion: 'anotar', respuesta: 'Te anoto la llamada.', tareas: [{ que: 'Llamar al banco', responsable: '', plazo: '2026-09-28' }] },
    })
    const audio = g.subirAChat(300_000, 'audio/x-m4a')
    const r = escribir(g, FER, '', [audio])
    expect(r).toContain('Llamar al banco — Fernando Méndez · lun 28/09')

    const partes = g.pedidosGemini.at(-1)!.cuerpo.contents[0].parts
    expect(partes[0].inline_data.mime_type).toBe('audio/mp4')
    expect(g.hoja('Tareas')[1][9]).toBe('nota de voz')
  })

  it('"¿qué tengo pendiente?" dicho en voz alta también funciona', () => {
    const g = instalado({ nota: { intencion: 'pendientes', respuesta: '', tareas: [] } })
    expect(escribir(g, FER, '', [g.subirAChat(100_000)])).toBe('No tenés nada pendiente.')
  })
})

describe('reuniones', () => {
  const MINUTA = {
    titulo: 'Seguimiento comercial',
    resumen: 'Se revisó el presupuesto.',
    duracionMinutos: 99,
    participantes: [{ nombre: 'Fernando Méndez', rol: 'Marketing' }, { nombre: 'Diana Valiente' }],
    decisiones: ['El precio va sin IVA.'],
    compromisos: [
      { que: 'Cerrar el presupuesto', responsable: 'Diana Valiente', plazo: '2026-09-29' },
      { que: 'Revisar el contrato', responsable: '', plazo: '' },
    ],
    preguntasAbiertas: [],
    riesgos: [],
  }

  /** Cada tramo devuelve un turno que dice qué rango se pidió. */
  const tramoQueRepite = (cuerpo: any) => {
    const texto = cuerpo.contents[0].parts[1].text as string
    const rango = texto.match(/entre ([\d:]+) y ([\d:]+)/)!
    return { turnos: [{ desde: 0, quien: 'Diana Valiente', texto: `tramo ${rango[1]}-${rango[2]}` }] }
  }

  const reunionEnCola = (guion: any) => {
    const g = instalado(guion)
    escribir(g, DIANA, 'hola')
    escribir(g, FER, 'reunión con Diana', [g.subirAChat(5 * 1024 * 1024)])
    return g
  }
  const fila = (g: any) => g.hoja('Reuniones')[1]
  const doc = (g: any) => [...new Set(g.documentos.values())][0] as any

  it('un audio largo queda en cola y se contesta enseguida, sin hacer esperar a Chat', () => {
    const g = instalado()
    const r = escribir(g, FER, 'reunión de seguimiento con Diana', [g.subirAChat(5 * 1024 * 1024)])
    expect(r).toContain('Recibí la reunión (5 MB)')
    expect(g.hoja('Reuniones')[1][9]).toBe('recibida')
    expect(g.pedidosGemini.filter((p) => p.tipo !== 'prueba')).toHaveLength(0)
  })

  it('la minuta sale primero y en un solo pedido, con las tareas repartidas', () => {
    const g = reunionEnCola({ minuta: MINUTA, tramo: tramoQueRepite, minutosDeAudio: 25 })
    g.llamar('procesarReuniones')

    expect(fila(g)[9]).toBe('transcribiendo')
    expect(fila(g)[2]).toBe('Seguimiento comercial')
    // Manda la duración que cobró Gemini, no la que estimó el modelo (99).
    expect(fila(g)[16]).toBe(25)

    // El audio fue por la Files API, como blob y no como arreglo de bytes.
    const datos = g.pedidosGemini.find((p) => p.tipo === 'subida-datos')!
    expect(datos.cuerpo.payload.constructor.name).toBe('Blob')
    const pedido = g.pedidosGemini.find((p) => p.tipo === 'minuta')!
    expect(pedido.cuerpo.contents[0].parts[0].file_data.file_uri).toContain('files/abc')
    expect(pedido.cuerpo.contents[0].parts[1].text).toContain('reunión con Diana')
    // Con el modelo por defecto, el razonamiento se acota por nivel.
    expect(pedido.url).toContain('models/gemini-3.6-flash:')
    expect(pedido.cuerpo.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })

    expect(doc(g).hijos[0].texto).toBe('Seguimiento comercial')
    expect(doc(g).texto()).toContain('Fernando Méndez (Marketing)')
    expect(doc(g).texto()).toContain('Cerrar el presupuesto — Diana Valiente, para el mar 29/09')
    expect(doc(g).texto()).toContain('se está armando')

    // Un compromiso sin dueño queda sin dueño: en una reunión no es de quien grabó.
    expect(g.hoja('Tareas').slice(1).map((t: any) => [t[2], t[3]])).toEqual([
      ['Cerrar el presupuesto', 'Diana Valiente'],
      ['Revisar el contrato', ''],
    ])
    expect(g.correos.find((c) => c.to === 'diana@empresa.com').body).toContain('Sale de la minuta')
    expect(g.correos.find((c) => c.subject === 'Minuta: Seguimiento comercial').to).toBe('fernando@empresa.com')

    const carpeta = [...g.carpetas.values()].find((c) => c.nombre.includes('Seguimiento'))
    expect(carpeta.nombre).toBe('2026-09-25 — Seguimiento comercial')
  })

  it('la transcripción se completa de a tramos y reemplaza el aviso en el documento', () => {
    const g = reunionEnCola({ minuta: MINUTA, tramo: tramoQueRepite, minutosDeAudio: 25 })
    g.llamar('procesarReuniones') // minuta + tramo 0-10
    g.llamar('procesarReuniones') // tramo 10-20
    expect(fila(g)[17]).toBe(20)
    expect(fila(g)[9]).toBe('transcribiendo')

    g.llamar('procesarReuniones') // tramo 20-25 y cierre
    expect(fila(g)[9]).toBe('completa')

    const tramos = g.pedidosGemini.filter((p) => p.tipo === 'tramo')
    expect(tramos).toHaveLength(3)
    expect(tramos[0].cuerpo.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    // A cada tramo se le pasan los nombres de quienes estuvieron.
    expect(tramos[0].cuerpo.contents[0].parts[1].text).toContain('Fernando Méndez, Diana Valiente')

    const texto = doc(g).texto()
    expect(texto).not.toContain('se está armando')
    expect(texto).toContain('tramo 00:00-10:00')
    expect(texto).toContain('tramo 20:00-25:00')
    // Solo un correo de minuta: la transcripción no genera ruido.
    expect(g.correos.filter((c) => c.subject.startsWith('Minuta'))).toHaveLength(1)
  })

  it('si la transcripción falla, la minuta ya entregada no se toca y se deja constancia', () => {
    const g = reunionEnCola({
      minuta: MINUTA,
      minutosDeAudio: 25,
      fallaGemini: (t: string) => (t === 'tramo' ? 500 : undefined),
    })
    for (let i = 0; i < 6; i++) g.llamar('procesarReuniones')
    expect(fila(g)[9]).toBe('completa')
    expect(doc(g).texto()).toContain('No se pudo completar la transcripción literal')
    expect(g.correos.some((c) => c.subject.includes('No pude procesar'))).toBe(false)
  })

  it('si la minuta falla, reintenta; a la tercera avisa, y el audio no se pierde', () => {
    const g = reunionEnCola({ fallaGemini: (t: string) => (t === 'minuta' ? 500 : undefined) })
    g.llamar('procesarReuniones')
    expect(fila(g)[9]).toBe('subida')
    expect(fila(g)[13]).toBe(1)

    g.llamar('procesarReuniones')
    g.llamar('procesarReuniones')
    expect(fila(g)[9]).toBe('error')
    const aviso = g.correos.at(-1)
    expect(aviso.subject).toContain('No pude procesar la reunión')
    expect(aviso.body).toContain('no se perdió')

    // El audio se subió a Gemini una sola vez, no en cada reintento.
    expect(g.pedidosGemini.filter((p) => p.tipo === 'subida-datos')).toHaveLength(1)
    g.llamar('procesarReuniones')
    expect(g.pedidosGemini.filter((p) => p.tipo === 'minuta')).toHaveLength(3)
  })

  it('un audio demasiado grande se rechaza con explicación, sin quedar a medias', () => {
    const g = instalado()
    const r = escribir(g, FER, 'reunión', [g.subirAChat(60 * 1024 * 1024)])
    expect(r).toContain('pesa 60 MB')
    expect(g.hoja('Reuniones')).toHaveLength(1)
  })

  it('dos corridas a la vez no procesan la misma reunión', () => {
    const g = reunionEnCola({ minuta: MINUTA })
    g.props.set('PROCESANDO_HASTA', String(Date.parse(AHORA) + 60_000))
    g.llamar('procesarReuniones')
    expect(fila(g)[9]).toBe('recibida')
  })
})

describe('aviso de la mañana', () => {
  it('le manda a cada uno sus pendientes, con las vencidas contadas en el asunto', () => {
    const g = instalado({
      nota: {
        intencion: 'anotar',
        respuesta: 'Anotado.',
        tareas: [
          { que: 'Enviar el presupuesto', responsable: 'Diana', plazo: '2026-09-22' },
          { que: 'Llamar al cliente', responsable: 'Diana', plazo: '' },
        ],
      },
    })
    escribir(g, DIANA, 'hola')
    escribir(g, FER, 'pedidos para Diana')
    g.correos.length = 0

    g.llamar('avisoMatutino')
    expect(g.correos).toHaveLength(1)
    expect(g.correos[0].to).toBe('diana@empresa.com')
    expect(g.correos[0].subject).toBe('Tus pendientes de hoy (1 vencida)')
    // Sin los asteriscos de Chat, que en un correo se verían como basura.
    expect(g.correos[0].body).not.toContain('*')
  })

  it('el fin de semana no molesta a nadie', () => {
    const g = crearGoogle({ ahora: '2026-09-26T13:00:00Z' })
    g.props.set('GEMINI_API_KEY', 'x')
    g.llamar('instalar')
    g.llamar('avisoMatutino')
    expect(g.correos).toHaveLength(0)
  })
})
