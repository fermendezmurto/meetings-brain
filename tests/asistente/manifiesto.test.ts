import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const leer = (f: string) => JSON.parse(readFileSync(path.join(__dirname, '../../asistente', f), 'utf8'))

/**
 * Con el manifiesto del formato clásico, Chat configurado como complemento de
 * Workspace nunca llama al código: la persona ve "Asistente no responde" y en
 * Ejecuciones no aparece nada. Pasó en la primera instalación real.
 */
describe('manifiesto', () => {
  const m = leer('appsscript.json')

  it('declara Chat como complemento de Workspace, como los ejemplos oficiales de Google', () => {
    expect(m.addOns.chat).toEqual({})
    expect(m.addOns.common.name).toBe('Asistente')
    expect(m.addOns.common.logoUrl).toMatch(/^https:\/\//)
    expect(m.chat).toBeUndefined()
  })

  it('pide los permisos que usa el código', () => {
    const codigo = readFileSync(path.join(__dirname, '../../asistente/dist/Asistente.gs'), 'utf8')
    const necesarios: [RegExp, string][] = [
      [/SpreadsheetApp\./, 'spreadsheets'],
      [/DriveApp\./, 'drive'],
      [/DocumentApp\./, 'documents'],
      [/UrlFetchApp\./, 'script.external_request'],
      [/MailApp\./, 'script.send_mail'],
      [/ScriptApp\.newTrigger/, 'script.scriptapp'],
      [/chat\.googleapis\.com\/v1\/media/, 'chat.messages.readonly'],
      [/CalendarApp\./, 'calendar'],
      [/Tasks\.Tasks\./, 'tasks'],
    ]
    for (const [uso, permiso] of necesarios) {
      expect(uso.test(codigo), `el código no usa ${uso}`).toBe(true)
      expect(m.oauthScopes).toContain(`https://www.googleapis.com/auth/${permiso}`)
    }
  })

  it('publica la aplicación web para la app del celular, que no inicia sesión con Google', () => {
    expect(m.webapp).toEqual({ executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' })
  })

  it('habilita el servicio avanzado de Google Tasks que usa el código', () => {
    const servicios = m.dependencies.enabledAdvancedServices
    expect(servicios).toContainEqual({ userSymbol: 'Tasks', version: 'v1', serviceId: 'tasks' })
  })

  it('el que se pega en Apps Script es el mismo', () => {
    expect(leer('dist/appsscript.json')).toEqual(m)
  })
})
