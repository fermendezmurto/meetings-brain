import { describe, expect, it } from 'vitest'
import { crearGoogle, mensaje } from './google-falso'
import { aBase64 } from '../../movil/src/base64'
import { enviarGrabacion, ErrorDefinitivo } from '../../movil/src/subida'

/**
 * La app del celular contra el Asistente: vincular el teléfono con un código
 * pedido en Chat, mandar una grabación de a partes y seguir su estado. El
 * cliente de acá hace lo mismo que la app de verdad (movil/src/subida.ts).
 */

const AHORA = '2026-09-25T13:00:00Z'
const FER = { nombre: 'Fernando Méndez', email: 'fernando@empresa.com' }
const DIANA = { nombre: 'Diana Valiente', email: 'diana@empresa.com' }

const MINUTA = {
  titulo: 'Seguimiento comercial',
  resumen: 'Se revisó el presupuesto.',
  duracionMinutos: 30,
  participantes: [{ nombre: 'Fernando Méndez' }],
  decisiones: [],
  compromisos: [{ que: 'Cerrar el presupuesto', responsable: 'Diana Valiente', plazo: '2026-09-29' }],
  preguntasAbiertas: [],
  riesgos: [],
}

function instalado(guion = {}) {
  const g = crearGoogle({ ahora: AHORA, guion: { minuta: MINUTA, tramo: { turnos: [] }, minutosDeAudio: 30, ...guion } })
  g.props.set('GEMINI_API_KEY', 'AQ.clave-de-prueba')
  g.llamar('instalar')
  return g
}

const escribir = (g: any, quien: any, texto: string) =>
  g.comoUsuario(quien.email, () => g.llamar('onMessage', mensaje(quien, texto)).text as string)

/** Como la app: un POST con JSON. La aplicación web corre con la cuenta de quien instaló. */
function pedir(g: any, cuerpo: any) {
  const salida = g.llamar('doPost', { postData: { contents: JSON.stringify(cuerpo) } })
  expect(salida.tipo).toBe('application/json')
  return JSON.parse(salida.getContent())
}

function vincular(g: any, quien: any) {
  const codigo = escribir(g, quien, 'vincular').match(/(\d{3}) (\d{3})/)!
  const r = pedir(g, { accion: 'vincular', codigo: codigo[1] + codigo[2], dispositivo: 'Pixel 8' })
  expect(r.ok).toBe(true)
  return r.token as string
}

function audio(bytes: number) {
  const b = Buffer.alloc(bytes)
  for (let i = 0; i < bytes; i++) b[i] = (i * 7 + (i >> 12)) % 256
  return b
}

/** La app de verdad (movil/src/subida.ts), hablándole al Asistente simulado. */
async function enviar(g: any, token: string, id: string, datos: Buffer, extra: { nota?: string } = {}) {
  await enviarGrabacion(
    { id, tamanio: datos.length, tipo: 'audio/mp4', ...extra },
    token,
    async (cuerpo) => pedir(g, cuerpo),
    (desde, largo) => new Uint8Array(datos.subarray(desde, desde + largo)),
    { esperar: async () => {} },
  )
  return { ok: true, terminada: true }
}

describe('vincular el teléfono', () => {
  it('con el código que da Chat, la app queda a nombre de quien lo pidió', () => {
    const g = instalado()
    const texto = escribir(g, DIANA, 'vincular')
    expect(texto).toContain('Código para la app')
    const codigo = texto.match(/(\d{3}) (\d{3})/)!
    const r = pedir(g, { accion: 'vincular', codigo: `${codigo[1]} ${codigo[2]}` })
    expect(r).toMatchObject({ ok: true, nombre: 'Diana Valiente', email: 'diana@empresa.com' })
    expect(r.token).toMatch(/^[0-9a-f]{64}$/)
    expect(pedir(g, { accion: 'yo', token: r.token })).toMatchObject({ ok: true, email: 'diana@empresa.com' })
  })

  it('el código sirve una sola vez y vence a los 10 minutos', () => {
    const g = instalado()
    const codigo = escribir(g, FER, 'vincular').match(/(\d{3}) (\d{3})/)!.slice(1).join('')
    expect(pedir(g, { accion: 'vincular', codigo }).ok).toBe(true)
    const otraVez = pedir(g, { accion: 'vincular', codigo })
    expect(otraVez.ok).toBe(false)
    expect(otraVez.error).toContain('vincular')

    const nuevo = escribir(g, FER, 'vincular').match(/(\d{3}) (\d{3})/)!.slice(1).join('')
    g.avanzar(11 * 60 * 1000)
    expect(pedir(g, { accion: 'vincular', codigo: nuevo }).ok).toBe(false)
  })

  it('después de muchos códigos equivocados deja de aceptar, para que no se pueda adivinar', () => {
    const g = instalado()
    const bueno = escribir(g, FER, 'vincular').match(/(\d{3}) (\d{3})/)!.slice(1).join('')
    for (let i = 0; i < 20; i++) pedir(g, { accion: 'vincular', codigo: '000000' })
    const r = pedir(g, { accion: 'vincular', codigo: bueno })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('demasiados')
  })

  it('sin vincular no se puede hacer nada, y la app sabe que tiene que pedir código', () => {
    const g = instalado()
    const r = pedir(g, { accion: 'iniciar', token: 'a'.repeat(64), id: 'abc12345', tamanio: 10 })
    expect(r).toMatchObject({ ok: false, desvinculado: true })
    expect(pedir(g, { accion: 'yo' }).desvinculado).toBe(true)
  })
})

describe('mandar una grabación', () => {
  it('llega entera a Drive, queda en cola como reunión de quien grabó, y sale la minuta', async () => {
    const g = instalado()
    escribir(g, DIANA, 'hola')
    const token = vincular(g, FER)
    const datos = audio(10 * 1024 * 1024 + 5)

    const r = await enviar(g, token, 'a1b2c3d4e5f6', datos, { nota: 'con Diana, presupuesto' })
    expect(r).toMatchObject({ ok: true, terminada: true })

    const pedazos = g.pedidosDrive.filter((p) => p.tipo === 'pedazo')
    expect(pedazos).toHaveLength(3)
    // Nunca se pidió a Drive seguir una redirección: el 308 es la respuesta.
    expect(pedazos.every((p) => p.o.followRedirects === false)).toBe(true)

    const fila = g.hoja('Reuniones')[1]
    expect(fila[0]).toBe('a1b2c3d4e5f6')
    expect(fila[3]).toBe('Fernando Méndez')
    expect(fila[4]).toBe('fernando@empresa.com')
    expect(fila[5]).toBe('con Diana, presupuesto')
    expect(fila[9]).toBe('recibida')
    const archivo = g.archivos.get(fila[7])
    expect(archivo.blob.bytes.equals(datos)).toBe(true)
    expect(archivo.getName()).toBe('audio-a1b2c3d4e5f6.m4a')
    expect(archivo.carpeta).toBe(fila[6])

    g.llamar('procesarReuniones')
    expect(g.subidoAGemini().equals(datos)).toBe(true)
    expect(g.correos.some((c: any) => c.to === 'fernando@empresa.com' && c.subject === 'Minuta: Seguimiento comercial')).toBe(true)

    const estado = pedir(g, { accion: 'estado', token, ids: ['a1b2c3d4e5f6'] })
    expect(estado.grabaciones).toHaveLength(1)
    expect(estado.grabaciones[0].titulo).toBe('Seguimiento comercial')
    expect(estado.grabaciones[0].minuta).toContain('docs.google.com')
  })

  it('si se corta la señal y no llega la respuesta, sigue desde lo que Drive ya tiene, sin repetir nada', async () => {
    const g = instalado({ fallaDrive: (n: number) => (n === 2 ? 'perder' : undefined) })
    const token = vincular(g, FER)
    const datos = audio(9 * 1024 * 1024)

    expect(await enviar(g, token, 'corte0001', datos)).toMatchObject({ ok: true, terminada: true })
    const fila = g.hoja('Reuniones')[1]
    expect(g.archivos.get(fila[7]).blob.bytes.equals(datos)).toBe(true)
    expect(g.pedidosDrive.some((p) => p.tipo === 'consulta')).toBe(true)
  })

  it('si Drive falla un momento, la parte se vuelve a mandar', async () => {
    const g = instalado({ fallaDrive: (n: number) => (n === 1 ? 503 : undefined) })
    const token = vincular(g, FER)
    const datos = audio(5 * 1024 * 1024)
    expect(await enviar(g, token, 'falla0001', datos)).toMatchObject({ ok: true, terminada: true })
    expect(g.archivos.get(g.hoja('Reuniones')[1][7]).blob.bytes.equals(datos)).toBe(true)
  })

  it('si la app vuelve a empezar la misma grabación, no se duplica nada', async () => {
    const g = instalado()
    const token = vincular(g, FER)
    const datos = audio(6 * 1024 * 1024)
    const primero = pedir(g, { accion: 'iniciar', token, id: 'repite001', tamanio: datos.length, tipo: 'audio/mp4' })
    pedir(g, { accion: 'parte', token, id: 'repite001', desde: 0, datos: datos.subarray(0, primero.parteBytes).toString('base64') })

    const otraVez = pedir(g, { accion: 'iniciar', token, id: 'repite001', tamanio: datos.length, tipo: 'audio/mp4' })
    expect(otraVez.recibidos).toBe(4 * 1024 * 1024)
    expect(g.pedidosDrive.filter((p) => p.tipo === 'sesion')).toHaveLength(1)

    await enviar(g, token, 'repite001', datos)
    await enviar(g, token, 'repite001', datos)
    expect(g.hoja('Reuniones')).toHaveLength(2)
  })

  it('nadie puede meterse en la grabación de otro ni ver su estado', async () => {
    const g = instalado()
    const deFer = vincular(g, FER)
    const deDiana = vincular(g, DIANA)
    const datos = audio(5 * 1024 * 1024)
    pedir(g, { accion: 'iniciar', token: deFer, id: 'privada01', tamanio: datos.length, tipo: 'audio/mp4' })

    const ajena = pedir(g, { accion: 'parte', token: deDiana, id: 'privada01', desde: 0, datos: datos.subarray(0, 4 * 1024 * 1024).toString('base64') })
    expect(ajena).toMatchObject({ ok: false })
    expect(ajena.error).toContain('otra persona')

    await enviar(g, deFer, 'privada01', datos)
    expect(pedir(g, { accion: 'estado', token: deDiana, ids: ['privada01'] }).grabaciones).toEqual([])
  })

  it('una grabación enorme se rechaza antes de empezar', () => {
    const g = instalado()
    const token = vincular(g, FER)
    const r = pedir(g, { accion: 'iniciar', token, id: 'enorme001', tamanio: 600 * 1024 * 1024 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('600 MB')
    expect(g.pedidosDrive).toHaveLength(0)
  })

  it('la aplicación web contesta que está viva, para que la app confirme la dirección', () => {
    const g = instalado()
    const r = JSON.parse(g.llamar('doGet', {}).getContent())
    expect(r).toMatchObject({ ok: true, servicio: 'Asistente', version: 1 })
  })
})

describe('la app', () => {
  it('pasa los bytes a base64 igual que Node, con cualquier largo', () => {
    for (const largo of [0, 1, 2, 3, 4, 5, 12287, 12288, 12289, 100000]) {
      const b = audio(largo)
      expect(aBase64(new Uint8Array(b))).toBe(b.toString('base64'))
    }
  })

  it('sin señal espera y reintenta, y termina cuando vuelve la conexión', async () => {
    const g = instalado()
    const token = vincular(g, FER)
    const datos = audio(5 * 1024 * 1024)
    let cortes = 3
    const esperas: number[] = []
    await enviarGrabacion(
      { id: 'sinsenal01', tamanio: datos.length, tipo: 'audio/mp4' },
      token,
      async (cuerpo) => {
        if (cuerpo.accion === 'parte' && cortes-- > 0) throw new Error('Network request failed')
        return pedir(g, cuerpo)
      },
      (desde, largo) => new Uint8Array(datos.subarray(desde, desde + largo)),
      { esperar: async (ms) => { esperas.push(ms) } },
    )
    expect(g.archivos.get(g.hoja('Reuniones')[1][7]).blob.bytes.equals(datos)).toBe(true)
    // Cada vez espera más, para no gastar batería insistiendo.
    expect(esperas).toEqual([2000, 4000, 8000])
  })

  it('si el teléfono fue desvinculado, deja de insistir y lo dice', async () => {
    const g = instalado()
    const datos = audio(1000)
    await expect(enviarGrabacion(
      { id: 'desvinc01', tamanio: datos.length, tipo: 'audio/mp4' },
      'b'.repeat(64),
      async (cuerpo) => pedir(g, cuerpo),
      () => new Uint8Array(datos),
      { esperar: async () => {} },
    )).rejects.toMatchObject({ desvinculado: true })
  })

  it('lo que no se arregla reintentando (una grabación enorme) no se reintenta', async () => {
    const g = instalado()
    const token = vincular(g, FER)
    let pedidos = 0
    const error = await enviarGrabacion(
      { id: 'enorme002', tamanio: 900 * 1024 * 1024, tipo: 'audio/mp4' },
      token,
      async (cuerpo) => { pedidos++; return pedir(g, cuerpo) },
      () => new Uint8Array(0),
      { esperar: async () => {} },
    ).catch((err) => err)
    expect(error).toBeInstanceOf(ErrorDefinitivo)
    expect(error.message).toContain('900 MB')
    expect(pedidos).toBe(1)
  })
})
