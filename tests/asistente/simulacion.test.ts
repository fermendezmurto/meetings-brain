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

// Como en Chat: el Asistente corre con la cuenta de quien le escribe.
const escribir = (g: any, quien: any, texto: string, adjuntos: any[] = []) =>
  g.comoUsuario(quien.email, () => g.llamar('onMessage', mensaje(quien, texto, adjuntos)).text as string)

describe('instalar', () => {
  it('arma la carpeta, la base y las tareas automáticas, y prueba la clave', () => {
    const g = instalado()
    expect(g.props.get('CARPETA_ID')).toBeTruthy()
    expect(g.props.get('BASE_ID')).toBeTruthy()
    expect(g.hoja('Tareas')[0]).toContain('Plazo')
    expect(g.hoja('Personas')[0]).toEqual(['Nombre', 'Email', 'Última vez'])
    expect(g.disparadores.map((t: any) => t.funcion).sort()).toEqual(['avisoMatutino', 'procesarBandeja', 'procesarReuniones'])
    expect(g.pedidosGemini.at(-1)!.tipo).toBe('prueba')
  })

  it('se puede correr dos veces sin duplicar nada', () => {
    const g = instalado()
    const base = g.props.get('BASE_ID')
    g.llamar('instalar')
    expect(g.props.get('BASE_ID')).toBe(base)
    expect(g.disparadores).toHaveLength(3)
  })

  it('elige el modelo liviano entre los que Google ofrece a la clave, sin adivinar nombres', () => {
    const g = crearGoogle({ ahora: AHORA, guion: { modelosDisponibles: ['gemini-3.8-flash', 'gemini-3.9-flash-lite-preview', 'gemini-3.7-flash-lite'] } })
    g.props.set('GEMINI_API_KEY', 'AQ.x')
    g.llamar('instalar')
    expect(g.props.get('GEMINI_MODEL_NOTAS')).toBe('gemini-3.7-flash-lite')
  })

  it('no pisa el modelo que alguien eligió a mano', () => {
    const g = crearGoogle({ ahora: AHORA })
    g.props.set('GEMINI_API_KEY', 'AQ.x')
    g.props.set('GEMINI_MODEL_NOTAS', 'gemini-3.6-flash')
    g.llamar('instalar')
    expect(g.props.get('GEMINI_MODEL_NOTAS')).toBe('gemini-3.6-flash')
  })

  it('si no puede consultar la lista de modelos, instala igual con el liviano por defecto', () => {
    const g = crearGoogle({ ahora: AHORA, guion: { modelosDisponibles: null } })
    g.props.set('GEMINI_API_KEY', 'AQ.x')
    expect(() => g.llamar('instalar')).not.toThrow()
    expect(g.pedidosGemini.filter((p) => p.tipo === 'prueba').map((p) => p.url.match(/models\/([^:]+)/)![1]))
      .toEqual(['gemini-3.6-flash', 'gemini-3.5-flash-lite'])
  })

  it('si Gemini está saturado al instalar, queda instalado igual y lo advierte', () => {
    const g = crearGoogle({ ahora: AHORA, guion: { fallaGemini: () => 503 } })
    g.props.set('GEMINI_API_KEY', 'AQ.x')
    expect(() => g.llamar('instalar')).not.toThrow()
    expect(g.props.get('BASE_ID')).toBeTruthy()
    expect(g.disparadores).toHaveLength(3)
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
    g.props.set('GEMINI_MODEL_NOTAS', 'gemini-2.5-flash')
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
    const r = g.comoUsuario(FER.email, () => g.llamar('onAddedToSpace', { ...mensaje(FER, ''), type: 'ADDED_TO_SPACE' }))
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

  it('si Gemini se satura un instante, reintenta solo y la persona ni se entera', () => {
    let fallas = 1
    const g = instalado({
      nota: { intencion: 'pendientes', respuesta: '', tareas: [] },
      fallaGemini: (t: string) => (t === 'nota' && fallas-- > 0 ? 503 : undefined),
    })
    expect(escribir(g, FER, 'anotame algo')).toBe('No tenés nada pendiente.')
  })

  it('si Gemini sigue saturado, no hace esperar a nadie: guarda el mensaje y avisa que lo termina después', () => {
    const g = instalado({ fallaGemini: (t: string) => (t === 'nota' ? 503 : undefined) })
    expect(escribir(g, FER, 'anotame algo')).toBe('Lo recibí, pero Gemini está lento en este momento. Lo termino de anotar en un par de minutos y te confirmo por correo.')
    const [m] = g.hoja('Bandeja').slice(1)
    expect(m[4]).toBe('anotame algo')
    expect(m[7]).toBe('pendiente')
  })

  it('en Chat arranca por el modelo que viene respondiendo más rápido, según lo medido', () => {
    // Lo que se midió en el piloto: el liviano tardó 37 segundos y el grande 7.
    const g = instalado({
      nota: { intencion: 'pendientes', respuesta: '', tareas: [] },
      demora: (m: string) => (m === 'gemini-3.5-flash-lite' ? 36900 : 6900),
    })
    escribir(g, FER, 'anotame algo')
    const notas = g.pedidosGemini.filter((p) => p.tipo === 'nota')
    expect(notas).toHaveLength(1)
    expect(notas[0].url).toContain('models/gemini-3.6-flash:')
  })

  it('si todos vienen lentos, ni lo intenta en Chat: contesta al toque y lo termina después', () => {
    const g = instalado({
      nota: { intencion: 'anotar', respuesta: 'Anotado.', tareas: [{ tipo: 'tarea', que: 'Llamar al banco', responsable: '', plazo: '' }] },
      demora: () => 20000,
    })
    expect(escribir(g, FER, 'recordame llamar al banco')).toContain('te confirmo por correo')
    expect(g.pedidosGemini.filter((p) => p.tipo === 'nota')).toHaveLength(0)

    g.llamar('procesarBandeja')
    expect(g.hoja('Tareas').slice(1).map((t: any) => t[2])).toEqual(['Llamar al banco'])
  })

  it('si el primero está saturado, contesta el otro', () => {
    const g = instalado({
      nota: { intencion: 'pendientes', respuesta: '', tareas: [] },
      fallaGemini: (t: string, modelo: string) => (t === 'nota' && modelo === 'gemini-3.6-flash' ? 503 : undefined),
    })
    expect(escribir(g, FER, 'anotame algo')).toBe('No tenés nada pendiente.')
    expect(g.pedidosGemini.at(-1)!.url).toContain('models/gemini-3.5-flash-lite:')
  })

  it('el que acaba de fallar pasa al final de la fila en el mensaje siguiente', () => {
    let fallasDelGrande = 1
    const g = instalado({
      nota: { intencion: 'pendientes', respuesta: '', tareas: [] },
      fallaGemini: (t: string, m: string) => (t === 'nota' && m === 'gemini-3.6-flash' && fallasDelGrande-- > 0 ? 503 : undefined),
    })
    escribir(g, FER, 'anotame algo')
    g.pedidosGemini.length = 0
    escribir(g, FER, 'anotame otra cosa')
    expect(g.pedidosGemini.filter((p) => p.tipo === 'nota')[0].url).toContain('gemini-3.5-flash-lite')
  })

  it('con saturación intermitente, alterna los modelos hasta que uno contesta', () => {
    // Lo que pasó en el piloto: un pedido pasa y el siguiente no.
    let rechazos = 3
    const g = instalado({
      nota: { intencion: 'pendientes', respuesta: '', tareas: [] },
      fallaGemini: (t: string) => (t === 'nota' && rechazos-- > 0 ? 503 : undefined),
    })
    expect(escribir(g, FER, 'anotame algo')).toBe('No tenés nada pendiente.')
    const modelos = g.pedidosGemini.filter((p) => p.tipo === 'nota').map((p) => p.url.match(/models\/([^:]+)/)![1])
    expect(modelos).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'])
  })

  it('si sigue saturado, deja de insistir en Chat con un tope', () => {
    const g = instalado({ fallaGemini: (t: string) => (t === 'nota' ? 503 : undefined) })
    expect(escribir(g, FER, 'anotame algo')).toBe('Lo recibí, pero Gemini está lento en este momento. Lo termino de anotar en un par de minutos y te confirmo por correo.')
    expect(g.pedidosGemini.filter((p) => p.tipo === 'nota')).toHaveLength(6)
  })

  it('ante el límite de pedidos deja de insistir, porque insistir lo empeora', () => {
    const g = instalado({
      fallaGemini: (t: string, modelo: string) => (t !== 'nota' ? undefined : modelo === 'gemini-3.6-flash' ? 503 : 429),
    })
    expect(escribir(g, FER, 'anotame algo')).toBe('Lo recibí, pero Gemini está lento en este momento. Lo termino de anotar en un par de minutos y te confirmo por correo.')
    expect(g.pedidosGemini.filter((p) => p.tipo === 'nota')).toHaveLength(2)
  })

  it('si el respaldo no existe, igual avisa la saturación y no un error técnico', () => {
    const g = instalado({
      modelosRetirados: ['gemini-9-flash-lite'],
      fallaGemini: (t: string, modelo: string) => (t === 'nota' && modelo === 'gemini-3.6-flash' ? 503 : undefined),
    })
    g.props.set('GEMINI_MODEL_NOTAS', 'gemini-9-flash-lite')
    const r = escribir(g, FER, 'anotame algo')
    expect(r).toBe('Lo recibí, pero Gemini está lento en este momento. Lo termino de anotar en un par de minutos y te confirmo por correo.')
    expect(r).not.toContain('404')
  })

  it('si el respaldo no acepta el parámetro de razonamiento, se le pide sin él', () => {
    const g = instalado({
      nota: { intencion: 'pendientes', respuesta: '', tareas: [] },
      rechazaRazonamientoEn: ['gemini-3.5-flash-lite'],
      fallaGemini: (t: string, modelo: string) => (t === 'nota' && modelo === 'gemini-3.6-flash' ? 503 : undefined),
    })
    expect(escribir(g, FER, 'anotame algo')).toBe('No tenés nada pendiente.')
  })

  it('con un solo modelo para todo, reintenta el mismo', () => {
    let fallas = 1
    const g = instalado({
      nota: { intencion: 'pendientes', respuesta: '', tareas: [] },
      fallaGemini: (t: string) => (t === 'nota' && fallas-- > 0 ? 503 : undefined),
    })
    g.props.set('GEMINI_MODEL_NOTAS', 'gemini-3.6-flash')
    expect(escribir(g, FER, 'anotame algo')).toBe('No tenés nada pendiente.')
    expect(g.pedidosGemini.filter((p) => p.tipo === 'nota').every((p) => p.url.includes('gemini-3.6-flash:'))).toBe(true)
  })

  it('un error que no se arregla solo llega como mensaje claro, no como silencio', () => {
    const g = instalado({ fallaGemini: (t: string) => (t === 'nota' ? 400 : undefined) })
    const r = escribir(g, FER, 'anotame algo')
    expect(r).toContain('Algo falló de mi lado')
    expect(g.hoja('Bandeja')[1][7]).toBe('error')
  })

  it('con una sola función para todos los activadores, saluda, ayuda y no le contesta a quien lo quitó', () => {
    const g = instalado()
    const usuario = { displayName: FER.nombre, email: FER.email }
    const agregado = g.llamar('onMessage', { chat: { user: usuario, addedToSpacePayload: { space: { spaceType: 'DIRECT_MESSAGE' } } } })
    expect(agregado.hostAppDataAction.chatDataAction.createMessageAction.message.text).toContain('Hola, Fernando')
    const comando = g.llamar('onMessage', { chat: { user: usuario, appCommandPayload: { message: {}, space: {} } } })
    expect(comando.hostAppDataAction.chatDataAction.createMessageAction.message.text).toContain('Qué podés hacer conmigo')
    expect(g.llamar('onMessage', { chat: { user: usuario, removedFromSpacePayload: { space: {} } } })).toEqual({})
  })

  it('contesta en el formato nuevo de Google cuando llega en ese formato', () => {
    const g = instalado()
    const r = g.llamar('onMessage', {
      chat: { user: { displayName: FER.nombre, email: FER.email }, messagePayload: { message: { text: 'ayuda' }, space: {} } },
    })
    expect(r.hostAppDataAction.chatDataAction.createMessageAction.message.text).toContain('Qué podés hacer conmigo')
  })
})

describe('calendario y Google Tasks', () => {
  const RONY = { nombre: 'Rony Benítez', email: 'rony@empresa.com' }
  const nota = (tareas: any[], respuesta = 'Anotado.') => ({ nota: { intencion: 'anotar', respuesta, tareas } })
  const fila = (g: any, n: number) => g.hoja('Tareas')[n]

  it('una reunión con hora va a tu calendario, a esa hora, con invitación a quien conoce', () => {
    const g = instalado(nota([
      { tipo: 'evento', que: 'Reunión con Rony', responsable: '', plazo: '2026-09-26', hora: '17:00', participantes: ['Rony'] },
    ], 'Agendo la reunión con Rony.'))
    escribir(g, RONY, 'hola')
    const r = escribir(g, FER, 'reunión con Rony mañana a las 5 de la tarde')

    expect(r).toContain('Reunión con Rony — Fernando Méndez · mañana 17:00')
    expect(r).toContain('Lo agendé en tu calendario e invité a Rony.')

    expect(g.eventos).toHaveLength(1)
    const e = g.eventos[0]
    expect(e.duenio).toBe('fernando@empresa.com')
    // 17:00 en Asunción son las 20:00 UTC; dura una hora si no se dijo otra cosa.
    expect(e.inicio.toISOString()).toBe('2026-09-26T20:00:00.000Z')
    expect(e.fin.toISOString()).toBe('2026-09-26T21:00:00.000Z')
    expect(e.guests).toBe('rony@empresa.com')
    expect(e.sendInvites).toBe(true)

    // En la base queda como evento, con la hora como texto y el id del calendario.
    expect(fila(g, 1).slice(12, 15)).toEqual(['evento', '17:00', e.id])
    // Un evento no va a Google Tasks, ni se manda correo: la invitación ya avisa.
    expect(g.tasksDe(FER.email)).toHaveLength(0)
    expect(g.correos).toHaveLength(0)
  })

  it('una reunión con fecha pero sin hora queda como evento de todo el día', () => {
    const g = instalado(nota([{ tipo: 'evento', que: 'Visita a la planta', responsable: '', plazo: '2026-09-28' }]))
    escribir(g, FER, 'el lunes visitamos la planta')
    expect(g.eventos[0].todoElDia).toBe(true)
  })

  it('avisa a quién no pudo invitar porque no lo conoce', () => {
    const g = instalado(nota([{ tipo: 'evento', que: 'Llamada', responsable: '', plazo: '2026-09-26', hora: '10:00', participantes: ['Rodolfo'] }]))
    expect(escribir(g, FER, 'llamada con Rodolfo mañana a las 10')).toContain('No conozco a Rodolfo, así que no pude invitarlo.')
  })

  it('entiende la fecha aunque el modelo la devuelva en otro formato', () => {
    // Lo que pasó en el piloto: "el viernes" quedó sin fecha.
    const g = instalado(nota([{ tipo: 'tarea', que: 'Mandar la propuesta', responsable: '', plazo: '25/09/2026' }]))
    expect(escribir(g, FER, 'recordame mandar la propuesta el viernes')).toContain('Mandar la propuesta — Fernando Méndez · hoy')
    expect(g.tasksDe(FER.email)[0].due).toBe('2026-09-25T00:00:00.000Z')
  })

  it('una hora con segundos sigue siendo un evento a esa hora', () => {
    const g = instalado(nota([{ tipo: 'evento', que: 'Llamada', responsable: '', plazo: '2026-09-26T00:00:00', hora: '13:00:00' }]))
    escribir(g, FER, 'llamada mañana a la una')
    expect(g.eventos[0].inicio.toISOString()).toBe('2026-09-26T16:00:00.000Z')
  })

  it('una tarea propia va directo a tu Google Tasks, con su fecha', () => {
    const g = instalado(nota([{ tipo: 'tarea', que: 'Mandar la propuesta', responsable: '', plazo: '2026-09-29' }]))
    const r = escribir(g, FER, 'recordame mandar la propuesta el martes')
    expect(r).toContain('En tu Google Tasks.')

    const [t] = g.tasksDe(FER.email)
    expect(t.title).toBe('Mandar la propuesta')
    expect(t.due).toBe('2026-09-29T00:00:00.000Z')
    expect(t.notes).toContain('Tarea #1 del Asistente')
    expect(fila(g, 1)[15]).toBe(t.id)
  })

  it('una tarea para otra persona le llega por correo, y a su Google Tasks cuando le escribe al Asistente', () => {
    const g = instalado(nota([{ tipo: 'tarea', que: 'Enviar el presupuesto', responsable: 'Diana', plazo: '2026-09-29' }]))
    escribir(g, DIANA, 'hola')
    expect(escribir(g, FER, 'pedile a Diana el presupuesto')).toContain('Le avisé por correo.')
    expect(g.correos.at(-1).to).toBe('diana@empresa.com')
    // Google no deja escribir en la lista de otra persona.
    expect(g.tasksDe(DIANA.email)).toHaveLength(0)

    escribir(g, DIANA, 'hola')
    const [t] = g.tasksDe(DIANA.email)
    expect(t.title).toBe('Enviar el presupuesto')
    expect(fila(g, 1)[15]).toBe(t.id)
  })

  it('si la persona la marca como hecha en Google Tasks, se cierra en la base y le avisa a quien la pidió', () => {
    const g = instalado(nota([{ tipo: 'tarea', que: 'Enviar el presupuesto', responsable: 'Diana', plazo: '' }]))
    escribir(g, DIANA, 'hola')
    escribir(g, FER, 'pedile a Diana el presupuesto')
    escribir(g, DIANA, 'hola')
    g.correos.length = 0

    g.tasksDe(DIANA.email)[0].status = 'completed'
    expect(escribir(g, DIANA, 'pendientes')).toBe('No tenés nada pendiente.')
    expect(fila(g, 1)[6]).toBe('cerrada')
    expect(g.correos.at(-1).to).toBe('fernando@empresa.com')
    expect(g.correos.at(-1).subject).toContain('Hecha: #1')
  })

  it('si se cierra por Chat, también se marca como hecha en Google Tasks', () => {
    const g = instalado(nota([{ tipo: 'tarea', que: 'Llamar al banco', responsable: '', plazo: '' }]))
    escribir(g, FER, 'recordame llamar al banco')
    escribir(g, FER, 'listo 1')
    expect(g.tasksDe(FER.email)[0].status).toBe('completed')
  })

  it('si quien pidió la cierra por Chat, el Google Tasks del responsable se pone al día en su próxima conversación', () => {
    const g = instalado(nota([{ tipo: 'tarea', que: 'Enviar el presupuesto', responsable: 'Diana', plazo: '' }]))
    escribir(g, DIANA, 'hola')
    escribir(g, FER, 'pedile a Diana el presupuesto')
    escribir(g, DIANA, 'hola')
    escribir(g, FER, 'listo 1')
    expect(g.tasksDe(DIANA.email)[0].status).toBe('needsAction')
    escribir(g, DIANA, 'hola')
    expect(g.tasksDe(DIANA.email)[0].status).toBe('completed')
  })

  it('un evento que ya pasó no aparece como pendiente', () => {
    const g = instalado(nota([{ tipo: 'evento', que: 'Reunión de ayer', responsable: '', plazo: '2026-09-24', hora: '10:00' }]))
    escribir(g, FER, 'anotá la reunión de ayer')
    expect(escribir(g, FER, 'pendientes')).toBe('No tenés nada pendiente.')
  })

  it('si Calendar no está habilitado, lo anotado no se pierde y lo dice', () => {
    const g = instalado({ ...nota([{ tipo: 'evento', que: 'Reunión con Rony', responsable: '', plazo: '2026-09-26', hora: '17:00' }]), fallaCalendar: true })
    const r = escribir(g, FER, 'reunión con Rony mañana a las 5')
    expect(r).toContain('Quedó anotado, pero no pude agendarlo en el calendario')
    expect(fila(g, 1)[2]).toBe('Reunión con Rony')
  })

  it('si Google Tasks no está habilitado, el Asistente sigue funcionando', () => {
    const g = instalado({ ...nota([{ tipo: 'tarea', que: 'Llamar al banco', responsable: '', plazo: '' }]), fallaTasks: true })
    expect(escribir(g, FER, 'recordame llamar al banco')).toContain('Quedó anotado, pero no pude pasarlo a Google Tasks')
    expect(escribir(g, FER, 'pendientes')).toContain('Llamar al banco')
  })

  it('al instalar avisa si falta habilitar Calendar o Tasks, sin frenar la instalación', () => {
    const g = crearGoogle({ ahora: AHORA, guion: { fallaCalendar: true, fallaTasks: true } })
    g.props.set('GEMINI_API_KEY', 'AQ.x')
    expect(() => g.llamar('instalar')).not.toThrow()
    expect(g.disparadores).toHaveLength(3)
  })
})

describe('bandeja: nada se pierde', () => {
  const RONY = { nombre: 'Rony Benítez', email: 'rony@empresa.com' }
  const EVENTO = { tipo: 'evento', que: 'Reunión de pricing', responsable: '', plazo: '2026-09-26', hora: '13:00' }
  const TAREA = { tipo: 'tarea', que: 'Mandar la propuesta', responsable: '', plazo: '2026-10-02' }

  /** Gemini saturado mientras la llave esté prendida. */
  const conSaturacion = (tareas: any[]) => {
    const estado = { saturado: true }
    const guion = {
      nota: { intencion: 'anotar', respuesta: 'Anotado.', tareas },
      fallaGemini: (t: string) => (t === 'nota' && estado.saturado ? 503 : undefined),
    }
    return { guion, estado }
  }

  it('lo que quedó pendiente se anota solo cuando Gemini se libera, y se confirma por correo', () => {
    const { guion, estado } = conSaturacion([TAREA])
    const g = instalado(guion)
    escribir(g, RONY, 'hola')
    expect(escribir(g, RONY, 'recordame mandar la propuesta el viernes')).toContain('te confirmo por correo')
    expect(g.hoja('Tareas')).toHaveLength(1)

    estado.saturado = false
    g.llamar('procesarBandeja')

    const tarea = g.hoja('Tareas')[1]
    expect(tarea.slice(2, 5)).toEqual(['Mandar la propuesta', 'Rony Benítez', 'rony@empresa.com'])
    expect(g.hoja('Bandeja')[1][7]).toBe('lista')
    const correo = g.correos.at(-1)
    expect(correo.to).toBe('rony@empresa.com')
    expect(correo.subject).toBe('Listo: recordame mandar la propuesta el viernes')
    // Corre con la cuenta de quien instaló: la lista de Rony no está a su alcance,
    // así que no se la toca, y se le dice cuándo va a aparecer.
    expect(correo.body).toContain('Aparece en tu Google Tasks la próxima vez que me escribas.')
    expect(g.tasksDe(RONY.email)).toHaveLength(0)
    expect(g.tasksDe(FER.email)).toHaveLength(0)

    // Y aparece, en efecto, cuando Rony vuelve a escribir.
    escribir(g, RONY, 'hola')
    expect(g.tasksDe(RONY.email).map((t: any) => t.title)).toEqual(['Mandar la propuesta'])
  })

  it('un evento de otra persona procesado después va con un enlace para agregarlo al calendario', () => {
    const { guion, estado } = conSaturacion([EVENTO])
    const g = instalado(guion)
    escribir(g, RONY, 'agenda la reunión de pricing mañana a las 13')
    estado.saturado = false
    g.llamar('procesarBandeja')

    expect(g.eventos).toHaveLength(0)
    const cuerpo = g.correos.at(-1).body
    expect(cuerpo).toContain('Agregalo a tu calendario con un clic: https://calendar.google.com/calendar/render?action=TEMPLATE')
    // 13:00 en Asunción son las 16:00 UTC.
    expect(cuerpo).toContain('dates=20260926T160000Z/20260926T170000Z')
    // En un correo no van los asteriscos de Chat.
    expect(cuerpo).not.toContain('*#1*')
  })

  it('si el mensaje era de quien instaló, lo agenda directo en su calendario', () => {
    const { guion, estado } = conSaturacion([EVENTO])
    const g = instalado(guion)
    escribir(g, FER, 'agenda la reunión de pricing mañana a las 13')
    estado.saturado = false
    g.llamar('procesarBandeja')
    expect(g.eventos).toHaveLength(1)
    expect(g.eventos[0].duenio).toBe(FER.email)
  })

  it('una nota de voz pendiente se guarda en Drive hasta procesarla, y después se borra', () => {
    const { guion, estado } = conSaturacion([TAREA])
    const g = instalado(guion)
    escribir(g, FER, '', [g.subirAChat(200_000)])
    const audioId = g.hoja('Bandeja')[1][5]
    const audio = g.archivos.get(audioId)
    expect(audio.getSize()).toBe(200_000)

    estado.saturado = false
    g.llamar('procesarBandeja')
    const pedido = g.pedidosGemini.filter((p) => p.tipo === 'nota').at(-1)!
    expect(pedido.cuerpo.contents[0].parts[0].inline_data).toBeTruthy()
    expect(audio.enPapelera).toBe(true)
    expect(g.hoja('Tareas')[1][9]).toBe('nota de voz')
  })

  it('si Google corta la ejecución a la mitad, a los dos minutos se retoma', () => {
    const g = instalado({ nota: { intencion: 'anotar', respuesta: 'Anotado.', tareas: [TAREA] } })
    // Lo que pasó en el piloto: el mensaje quedó guardado y la ejecución murió.
    g.comoUsuario(FER.email, () => g.llamar('encolarMensaje_', { quien: FER.nombre, email: FER.email, texto: 'recordame mandar la propuesta' }))

    g.llamar('procesarBandeja')
    expect(g.hoja('Bandeja')[1][7]).toBe('procesando') // quizás todavía está trabajando

    g.avanzar(3 * 60 * 1000)
    g.llamar('procesarBandeja')
    expect(g.hoja('Bandeja')[1][7]).toBe('lista')
    expect(g.hoja('Tareas').slice(1).map((t: any) => t[2])).toEqual(['Mandar la propuesta'])
  })

  it('si la ejecución cortada alcanzó a anotar, no se anota dos veces', () => {
    const g = instalado({ nota: { intencion: 'anotar', respuesta: 'Anotado.', tareas: [TAREA] } })
    const m = g.comoUsuario(FER.email, () => g.llamar('encolarMensaje_', { quien: FER.nombre, email: FER.email, texto: 'x' }))
    g.comoUsuario(FER.email, () => g.llamar('agregarTarea_', {
      que: 'Mandar la propuesta', responsable: FER.nombre, emailResponsable: FER.email, pidio: FER.nombre,
      emailPidio: FER.email, origen: 'mensaje', mensaje: m.id,
    }))
    g.avanzar(3 * 60 * 1000)
    g.llamar('procesarBandeja')
    expect(g.hoja('Tareas')).toHaveLength(2)
    expect(g.hoja('Bandeja')[1][7]).toBe('lista')
    expect(g.pedidosGemini.filter((p) => p.tipo === 'nota')).toHaveLength(0)
  })

  it('si Gemini no se libera en media hora, avisa por correo que no pudo', () => {
    const { guion } = conSaturacion([TAREA])
    const g = instalado(guion)
    escribir(g, FER, 'recordame mandar la propuesta')
    // El intento en Chat es el primero: quedan 29, uno por minuto.
    for (let i = 0; i < 28; i++) {
      g.avanzar(60 * 1000)
      g.llamar('procesarBandeja')
    }
    expect(g.hoja('Bandeja')[1][7]).toBe('pendiente')
    g.avanzar(60 * 1000)
    g.llamar('procesarBandeja')
    expect(g.hoja('Bandeja')[1][7]).toBe('error')
    const aviso = g.correos.at(-1)
    expect(aviso.subject).toBe('No pude anotar: recordame mandar la propuesta')
    expect(aviso.body).toContain('Intenté 30 veces')
  })

  it('sin nada pendiente, la tarea de cada minuto ni abre la planilla', () => {
    const g = instalado({ nota: { intencion: 'pendientes', respuesta: '', tareas: [] } })
    escribir(g, FER, 'anotame algo')
    g.llamar('procesarBandeja') // ve que está todo listo y apaga la marca
    expect(g.props.get('BANDEJA_PENDIENTE')).toBeUndefined()
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
    expect(g.pedidosGemini.filter((p) => !['prueba', 'lista-modelos'].includes(p.tipo))).toHaveLength(0)
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

    // Al lado del documento, la minuta como datos para el cerebro de la empresa.
    const archivoDatos = [...g.archivos.values()].find((a) => a.getName() === 'minuta.json')
    expect(archivoDatos.carpeta).toBe(carpeta.id)
    const minuta = JSON.parse(archivoDatos.getBlob().getDataAsString())
    expect(minuta).toMatchObject({ version: 1, tipo: 'minuta', titulo: 'Seguimiento comercial', duracionMinutos: 25 })
    expect(minuta.compromisos[0]).toEqual({
      tarea: 1, que: 'Cerrar el presupuesto', responsable: 'Diana Valiente', email: 'diana@empresa.com', plazo: '2026-09-29',
    })
    expect(minuta.enlaces.minuta).toContain('docs.google.com/document')
    // Cada tarea sabe de qué reunión salió.
    expect(g.hoja('Tareas')[1][16]).toBe(fila(g)[0])
  })

  it('un compromiso de quien instaló va directo a su Google Tasks', () => {
    const g = reunionEnCola({
      minutosDeAudio: 5,
      tramo: { turnos: [] },
      minuta: { ...MINUTA, compromisos: [{ que: 'Mandar el acta', responsable: 'Fernando Méndez', plazo: '' }] },
    })
    g.llamar('procesarReuniones')
    expect(g.tasksDe(FER.email).map((t: any) => t.title)).toEqual(['Mandar el acta'])
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

  it('si la minuta falla por algo que no se arregla solo, a la tercera avisa, y el audio no se pierde', () => {
    const g = reunionEnCola({ fallaGemini: (t: string) => (t === 'minuta' ? 400 : undefined) })
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

  it('si Gemini está saturado, no gasta los tres intentos: sigue probando una hora', () => {
    const g = reunionEnCola({ minuta: MINUTA, fallaGemini: (t: string) => (t === 'minuta' ? 503 : undefined) })
    for (let i = 0; i < 3; i++) g.llamar('procesarReuniones')
    expect(fila(g)[9]).toBe('subida')
    expect(g.correos.some((c) => c.subject.includes('No pude procesar'))).toBe(false)

    for (let i = 0; i < 9; i++) g.llamar('procesarReuniones')
    expect(fila(g)[9]).toBe('error')
    const aviso = g.correos.at(-1)
    expect(aviso.body).toContain('Intenté 12 veces')
    expect(aviso.body).toContain('saturado')
  })

  it('si el modelo grande está saturado, la minuta sale igual con el liviano', () => {
    const g = reunionEnCola({
      minuta: MINUTA, minutosDeAudio: 5, tramo: { turnos: [] },
      fallaGemini: (t: string, modelo: string) => (t === 'minuta' && modelo === 'gemini-3.6-flash' ? 503 : undefined),
    })
    g.llamar('procesarReuniones')
    expect(['transcribiendo', 'completa']).toContain(fila(g)[9])
    expect(g.pedidosGemini.filter((p) => p.tipo === 'minuta').at(-1)!.url).toContain('gemini-3.5-flash-lite')
  })

  it('si la saturación se pasa, la reunión sale sin que nadie haga nada', () => {
    let saturado = true
    const g = reunionEnCola({ minuta: MINUTA, minutosDeAudio: 5, tramo: { turnos: [] },
      fallaGemini: (t: string) => (t === 'minuta' && saturado ? 503 : undefined) })
    g.llamar('procesarReuniones')
    expect(fila(g)[9]).toBe('subida')
    saturado = false
    g.llamar('procesarReuniones')
    expect(['transcribiendo', 'completa']).toContain(fila(g)[9])
    expect(g.correos.some((c) => c.subject === 'Minuta: Seguimiento comercial')).toBe(true)
  })

  it('un audio de más de 50 MB llega entero a Gemini, de a pedazos y en orden', () => {
    const g = reunionEnCola({ minuta: MINUTA, minutosDeAudio: 180, tramo: { turnos: [] } })
    // Tres horas de reunión: más de lo que Apps Script puede bajar de una vez.
    const audio = g.archivos.get(fila(g)[7])
    const bytes = Buffer.alloc(70 * 1024 * 1024 + 123)
    for (let i = 0; i < bytes.length; i += 4096) bytes[i] = (i / 4096) % 251
    audio.blob.bytes = bytes

    g.llamar('procesarReuniones')

    expect(g.subidoAGemini().equals(bytes)).toBe(true)
    const pedazos = g.pedidosGemini.filter((p) => p.tipo === 'subida-datos')
    expect(pedazos).toHaveLength(5)
    expect(pedazos.map((p) => p.cuerpo.headers['X-Goog-Upload-Command'])).toEqual(
      ['upload', 'upload', 'upload', 'upload', 'upload, finalize'])
    // Ningún pedido pasa el límite de 50 MB de Apps Script.
    for (const p of pedazos) expect(p.cuerpo.payload.bytes.length).toBeLessThanOrEqual(50 * 1024 * 1024)
    expect(g.pedidosDrive.filter((p) => p.tipo === 'leer')).toHaveLength(5)
    expect(fila(g)[16]).toBe(180)
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
