import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const ctx = vm.createContext({})
vm.runInContext(
  readFileSync(path.join(__dirname, '../../asistente/src/Eventos.js'), 'utf8') +
    '\nthis.__e = { normalizarEvento, contestar, textoDelMensaje, adjuntoDeAudio, idDeDrive, tipoParaGemini }',
  ctx,
)
const e = (ctx as any).__e

describe('normalizarEvento', () => {
  it('entiende el formato clásico', () => {
    const ev = e.normalizarEvento({
      type: 'MESSAGE',
      user: { email: 'a@x.com', displayName: 'Ana' },
      message: { text: 'hola' },
      space: { type: 'DM' },
    })
    expect(ev).toMatchObject({ formato: 'clasico', tipo: 'MESSAGE', usuario: { email: 'a@x.com' } })
    expect(ev.mensaje.text).toBe('hola')
  })

  it('entiende el formato de complemento al que Google está migrando', () => {
    const ev = e.normalizarEvento({
      chat: {
        user: { email: 'a@x.com', displayName: 'Ana' },
        messagePayload: { message: { text: 'hola' }, space: { type: 'DM' } },
      },
    })
    expect(ev).toMatchObject({ formato: 'complemento', tipo: 'MESSAGE', usuario: { email: 'a@x.com' } })
    expect(ev.mensaje.text).toBe('hola')
  })

  it('reconoce los comandos de la app y cuando lo quitan de un espacio', () => {
    expect(e.normalizarEvento({ chat: { user: {}, appCommandPayload: { message: { text: '' } } } }).tipo).toBe('APP_COMMAND')
    expect(e.normalizarEvento({ chat: { user: {}, removedFromSpacePayload: { space: {} } } }).tipo).toBe('REMOVED_FROM_SPACE')
  })

  it('reconoce cuando lo agregan a una conversación', () => {
    expect(e.normalizarEvento({ chat: { user: {}, addedToSpacePayload: { space: {} } } }).tipo).toBe('ADDED_TO_SPACE')
    expect(e.normalizarEvento({ type: 'ADDED_TO_SPACE' }).tipo).toBe('ADDED_TO_SPACE')
  })

  it('contesta en el mismo formato en que le preguntaron', () => {
    expect(e.contestar({ formato: 'clasico' }, 'ok')).toEqual({ text: 'ok' })
    expect(e.contestar({ formato: 'complemento' }, 'ok').hostAppDataAction.chatDataAction.createMessageAction.message.text).toBe('ok')
  })
})

describe('mensajes', () => {
  it('en un espacio grupal ignora la mención', () => {
    expect(e.textoDelMensaje({ text: '@Asistente pendientes', argumentText: ' pendientes' })).toBe('pendientes')
  })

  it('encuentra el audio entre los adjuntos y deja de lado una imagen', () => {
    const audio = e.adjuntoDeAudio({
      attachment: [
        { contentType: 'image/png', contentName: 'foto.png' },
        { contentType: 'audio/mp4', contentName: 'nota.m4a' },
      ],
    })
    expect(audio.contentName).toBe('nota.m4a')
    expect(e.adjuntoDeAudio({ attachment: [{ contentType: 'image/png' }] })).toBeNull()
  })

  it('saca el id de un enlace de Drive pegado en el mensaje', () => {
    expect(e.idDeDrive('la reunión: https://drive.google.com/file/d/1AbC-dEfGhIjKlMnOpQrStUv/view?usp=sharing'))
      .toBe('1AbC-dEfGhIjKlMnOpQrStUv')
    expect(e.idDeDrive('sin enlace')).toBeNull()
  })

  it('lleva las etiquetas de audio de los teléfonos a la que reconoce Gemini', () => {
    expect(e.tipoParaGemini('audio/x-m4a')).toBe('audio/mp4')
    expect(e.tipoParaGemini('audio/ogg; codecs=opus')).toBe('audio/ogg')
  })
})
