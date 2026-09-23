import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { armar } from '../../scripts/armar-asistente.mjs'

/**
 * Una imitación de los servicios de Google que usa el Asistente, con lo justo
 * para recorrer el circuito entero sin conexión: planilla, Drive, Docs, Chat,
 * Gemini y correo.
 *
 * Imita a propósito las mañas de Google que muerden en producción: que Sheets
 * convierta solo un texto con forma de fecha, que los encabezados HTTP lleguen
 * con cualquier mayúscula, y que los objetos Date sean los del propio script.
 */

type Respuesta = Record<string, any>

export interface Guion {
  nota?: Respuesta | ((pedido: any) => Respuesta)
  tramo?: Respuesta | ((pedido: any) => Respuesta)
  minuta?: Respuesta | ((pedido: any) => Respuesta)
  /** Cuánto audio "cobra" Gemini en la minuta, en minutos. */
  minutosDeAudio?: number
  /** Si devuelve un número, Gemini responde con ese código de error. */
  fallaGemini?: (tipo: string, modelo: string) => number | undefined
  /** Modelos que Google ya no ofrece a cuentas nuevas. */
  modelosRetirados?: string[]
  /** Lo que devuelve la lista de modelos; null para que falle. */
  modelosDisponibles?: string[] | null
  /** El modelo rechaza la forma en que se le acota el razonamiento. */
  rechazaRazonamiento?: boolean
  /** Solo estos modelos rechazan el parámetro de razonamiento. */
  rechazaRazonamientoEn?: string[]
  /** Cuánto tarda cada modelo en contestar, en milisegundos. */
  demora?: (modelo: string, tipo: string) => number
  /** Calendar o Tasks sin habilitar en el proyecto. */
  fallaCalendar?: boolean
  fallaTasks?: boolean
}

export function crearGoogle(opciones: { ahora: string; guion?: Guion }) {
  let ahora = new Date(opciones.ahora).getTime()
  const guion: Guion = opciones.guion ?? {}

  // --- Registro de lo que pasó, para que las pruebas lo revisen ---
  const correos: any[] = []
  const pedidosGemini: { tipo: string; cuerpo: any; claveEnEncabezado: boolean; url: string }[] = []
  const disparadores: any[] = []
  const props = new Map<string, string>()
  const medios = new Map<string, { bytes: Buffer; tipo: string }>()

  let contexto: any

  // --- Quién está usando el Asistente: cada persona tiene su calendario y su lista ---
  const DUENIO = 'fernando@empresa.com'
  let usuario = DUENIO
  const eventos: any[] = []
  const listas = new Map<string, Map<string, any>>()
  const listaDe = (email: string) => {
    if (!listas.has(email)) listas.set(email, new Map())
    return listas.get(email)!
  }
  const APAGADA = (api: string) => new Error(`${api} has not been used in project 601153146863 before or it is disabled.`)

  const Session = { getEffectiveUser: () => ({ getEmail: () => usuario }) }

  const caches = new Map<string, Map<string, { valor: string; vence: number }>>()
  const cache = (clave: string) => {
    if (!caches.has(clave)) caches.set(clave, new Map())
    const m = caches.get(clave)!
    return {
      get: (k: string) => {
        const e = m.get(k)
        return e && e.vence > ahora ? e.valor : null
      },
      put: (k: string, v: string, segundos = 600) => { m.set(k, { valor: v, vence: ahora + segundos * 1000 }) },
      remove: (k: string) => { m.delete(k) },
    }
  }
  const CacheService = {
    getScriptCache: () => cache('script'),
    getUserCache: () => cache('usuario:' + usuario),
  }

  const CalendarApp = {
    getDefaultCalendar: () => {
      if (guion.fallaCalendar) throw APAGADA('Google Calendar API')
      const duenio = usuario
      const crear = (datos: any) => {
        const id = 'evento-' + randomUUID().slice(0, 8)
        eventos.push({ id, duenio, ...datos })
        return { getId: () => id }
      }
      return {
        getName: () => duenio,
        createEvent: (titulo: string, inicio: Date, fin: Date, op: any = {}) =>
          crear({ titulo, inicio: new Date(inicio.getTime()), fin: new Date(fin.getTime()), todoElDia: false, ...op }),
        createAllDayEvent: (titulo: string, dia: Date, op: any = {}) =>
          crear({ titulo, inicio: new Date(dia.getTime()), todoElDia: true, ...op }),
      }
    },
  }

  const Tasks = {
    Tasklists: {
      list: () => {
        if (guion.fallaTasks) throw APAGADA('Google Tasks API')
        return { items: [{ id: '@default' }] }
      },
    },
    Tasks: {
      insert: (t: any, lista: string) => {
        if (guion.fallaTasks) throw APAGADA('Google Tasks API')
        const id = 'task-' + randomUUID().slice(0, 8)
        listaDe(usuario).set(id, { ...t, id, lista, status: 'needsAction' })
        return { id }
      },
      list: () => {
        if (guion.fallaTasks) throw APAGADA('Google Tasks API')
        return { items: [...listaDe(usuario).values()] }
      },
      patch: (cambios: any, _lista: string, id: string) => {
        if (guion.fallaTasks) throw APAGADA('Google Tasks API')
        const t = listaDe(usuario).get(id)
        if (!t) throw new Error('Not Found')
        Object.assign(t, cambios)
        return t
      },
    },
  }

  // --- Blobs y Drive ---
  class Blob {
    constructor(public bytes: Buffer, public tipo: string, public nombre = 'archivo') {}
    getBytes() { return Array.from(this.bytes) }
    getContentType() { return this.tipo }
    setName(n: string) { this.nombre = n; return this }
    getName() { return this.nombre }
    getDataAsString() { return this.bytes.toString('utf8') }
  }

  const archivos = new Map<string, any>()
  const carpetas = new Map<string, any>()

  function nuevaCarpeta(nombre: string, padre: string | null) {
    const id = 'carpeta-' + randomUUID().slice(0, 8)
    const c = {
      id, nombre, padre,
      getId: () => id,
      getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      getName: () => c.nombre,
      setName: (n: string) => { c.nombre = n; return c },
      createFolder: (n: string) => nuevaCarpeta(n, id),
      getFoldersByName: (n: string) => {
        const hijas = [...carpetas.values()].filter((x) => x.padre === id && x.nombre === n)
        let i = 0
        return { hasNext: () => i < hijas.length, next: () => hijas[i++] }
      },
      createFile: (a: any, contenido?: string, tipo?: string) => {
        const blob = a instanceof Blob ? a : new Blob(Buffer.from(contenido ?? '', 'utf8'), tipo ?? 'text/plain', a)
        return nuevoArchivo(blob, id)
      },
    }
    carpetas.set(id, c)
    return c
  }

  function nuevoArchivo(blob: Blob, carpeta: string | null, idFijo?: string) {
    const id = idFijo ?? 'archivo-' + randomUUID().slice(0, 8)
    const a: any = {
      id, blob, carpeta,
      getId: () => id,
      getUrl: () => 'https://drive.google.com/file/d/' + id,
      getName: () => a.blob.nombre,
      getBlob: () => a.blob,
      getSize: () => a.blob.bytes.length,
      getMimeType: () => a.blob.tipo,
      moveTo: (c: any) => { a.carpeta = c.getId(); return a },
      setContent: (t: string) => { a.blob = new Blob(Buffer.from(t, 'utf8'), a.blob.tipo, a.blob.nombre); return a },
      enPapelera: false,
      setTrashed: (v: boolean) => { a.enPapelera = v; return a },
    }
    archivos.set(id, a)
    return a
  }

  const DriveApp = {
    createFolder: (n: string) => nuevaCarpeta(n, null),
    getFolderById: (id: string) => {
      const c = carpetas.get(id)
      if (!c) throw new Error('No existe la carpeta ' + id)
      return c
    },
    getFileById: (id: string) => {
      const a = archivos.get(id)
      if (!a) throw new Error('No existe el archivo ' + id)
      return a
    },
  }

  // --- Sheets ---
  const libros = new Map<string, any>()

  function nuevaHoja(nombre: string) {
    const filas: any[][] = []
    const convertir = (v: any) => {
      if (typeof v === 'string' && v.startsWith("'")) return v.slice(1)
      // Como Sheets: un texto que parece fecha se guarda como fecha.
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return new contexto.Date(v + 'T00:00:00-03:00')
      }
      return v
    }
    const h: any = {
      filas,
      getName: () => nombre,
      getLastRow: () => filas.length,
      appendRow: (fila: any[]) => { filas.push(fila.map(convertir)) },
      setFrozenRows: () => {},
      getRange: (fila: any, col?: number, n = 1, m = 1) => {
        if (typeof fila === 'string') return { setNumberFormat: () => ({}) }
        const r: any = {
          getValues: () => {
            const out = []
            for (let i = 0; i < n; i++) {
              const f = filas[fila - 1 + i] ?? []
              const linea = []
              for (let j = 0; j < m; j++) linea.push(f[col! - 1 + j] ?? '')
              out.push(linea)
            }
            return out
          },
          setValues: (v: any[][]) => {
            v.forEach((linea, i) => {
              filas[fila - 1 + i] = filas[fila - 1 + i] ?? []
              linea.forEach((x, j) => { filas[fila - 1 + i][col! - 1 + j] = convertir(x) })
            })
            return r
          },
          setValue: (x: any) => {
            filas[fila - 1] = filas[fila - 1] ?? []
            filas[fila - 1][col! - 1] = convertir(x)
            return r
          },
          setFontWeight: () => r,
          setNumberFormat: () => r,
        }
        return r
      },
    }
    return h
  }

  const SpreadsheetApp = {
    create: (nombre: string) => {
      const id = 'libro-' + randomUUID().slice(0, 8)
      const hojas = [nuevaHoja('Hoja 1')]
      const libro = {
        hojas,
        getId: () => id,
        getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
        getSheets: () => [...hojas],
        getSheetByName: (n: string) => hojas.find((x) => x.getName() === n) ?? null,
        insertSheet: (n: string) => { const h = nuevaHoja(n); hojas.push(h); return h },
        deleteSheet: (h: any) => { hojas.splice(hojas.indexOf(h), 1) },
        setSpreadsheetTimeZone: () => {},
      }
      libros.set(id, libro)
      nuevoArchivo(new Blob(Buffer.alloc(0), 'application/vnd.google-apps.spreadsheet', nombre), null, id)
      return libro
    },
    openById: (id: string) => {
      const l = libros.get(id)
      if (!l) throw new Error('No existe la planilla ' + id)
      return l
    },
  }

  // --- Docs ---
  const documentos = new Map<string, any>()
  const DocumentApp: any = {
    openByUrl: (url: string) => {
      const d = documentos.get(url)
      if (!d) throw new Error('No existe el documento ' + url)
      return d
    },
    ParagraphHeading: { TITLE: 'TITLE', HEADING2: 'HEADING2' },
    GlyphType: { BULLET: 'BULLET' },
    ElementType: { PARAGRAPH: 'PARAGRAPH' },
    create: (nombre: string) => {
      const id = 'doc-' + randomUUID().slice(0, 8)
      const hijos: any[] = []
      const parrafo = (texto: string, tipo = 'PARAGRAPH') => {
        const p: any = {
          texto, tipo, estilo: '',
          setHeading: (e: string) => { p.estilo = e; return p },
          setItalic: () => p, setFontSize: () => p, setGlyphType: () => p,
          getType: () => tipo,
          asParagraph: () => p,
          getText: () => p.texto,
          setText: (t: string) => { p.texto = t; return p },
          removeFromParent: () => { hijos.splice(hijos.indexOf(p), 1) },
        }
        hijos.push(p)
        return p
      }
      parrafo('') // Docs arranca con un párrafo vacío.
      const doc = {
        hijos, nombre,
        getId: () => id,
        getUrl: () => 'https://docs.google.com/document/d/' + id,
        getBody: () => ({
          appendParagraph: (t: string) => parrafo(t),
          appendListItem: (t: string) => parrafo(t, 'LIST_ITEM'),
          appendPageBreak: () => {},
          getChild: (i: number) => hijos[i],
          getParagraphs: () => [...hijos],
        }),
        saveAndClose: () => {},
        texto: () => hijos.map((h) => h.texto).join('\n'),
      }
      documentos.set(id, doc)
      documentos.set(doc.getUrl(), doc)
      nuevoArchivo(new Blob(Buffer.alloc(0), 'application/vnd.google-apps.document', nombre), null, id)
      return doc
    },
  }

  // --- Red: Chat y Gemini ---
  function respuesta(codigo: number, cuerpo: any, encabezados: Record<string, string> = {}, blob?: Blob) {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)
    return {
      getResponseCode: () => codigo,
      getContentText: () => texto,
      getAllHeaders: () => encabezados,
      getBlob: () => blob ?? new Blob(Buffer.from(texto), 'application/json'),
    }
  }

  function tipoDePedido(cuerpo: any) {
    const props = cuerpo?.generationConfig?.responseSchema?.properties ?? {}
    if ('intencion' in props) return 'nota'
    if ('turnos' in props) return 'tramo'
    if ('compromisos' in props) return 'minuta'
    if ('ok' in props) return 'prueba'
    return 'otro'
  }

  function resolver(r: any, pedido: any) {
    return typeof r === 'function' ? r(pedido) : r
  }

  const UrlFetchApp = {
    fetch: (url: string, o: any = {}) => {
      const encabezados = o.headers ?? {}
      if (url.startsWith('https://chat.googleapis.com/v1/media/')) {
        const recurso = url.slice('https://chat.googleapis.com/v1/media/'.length).split('?')[0]
        const m = medios.get(recurso)
        if (!m) return respuesta(404, 'no existe')
        // Mayúsculas a propósito: el código tiene que encontrarlo igual.
        return respuesta(200, '', { 'Content-Length': String(m.bytes.length) }, new Blob(m.bytes, m.tipo))
      }

      if (!url.startsWith('https://generativelanguage.googleapis.com')) {
        throw new Error('Pedido a un servidor inesperado: ' + url)
      }
      const claveEnEncabezado = Boolean(encabezados['x-goog-api-key'])

      if (url.endsWith('/upload/v1beta/files')) {
        pedidosGemini.push({ tipo: 'subida-inicio', cuerpo: o, claveEnEncabezado, url })
        return respuesta(200, '', { 'X-Goog-Upload-URL': 'https://generativelanguage.googleapis.com/subida/123' })
      }
      if (url.endsWith('/subida/123')) {
        pedidosGemini.push({ tipo: 'subida-datos', cuerpo: o, claveEnEncabezado, url })
        return respuesta(200, { file: { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', state: 'PROCESSING' } })
      }
      if (url.endsWith('/v1beta/files/abc')) return respuesta(200, { state: 'ACTIVE' })
      if (url.includes('/v1beta/models?')) {
        pedidosGemini.push({ tipo: 'lista-modelos', cuerpo: o, claveEnEncabezado, url })
        if (guion.modelosDisponibles === null) return respuesta(500, 'error')
        const nombres = guion.modelosDisponibles ?? ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']
        return respuesta(200, {
          models: [
            ...nombres.map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent', 'countTokens'] })),
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          ],
        })
      }

      if (url.includes(':generateContent')) {
        const cuerpo = JSON.parse(o.payload)
        const tipo = tipoDePedido(cuerpo)
        pedidosGemini.push({ tipo, cuerpo, claveEnEncabezado, url })
        const modelo = url.match(/models\/([^:]+):/)![1]
        ahora += guion.demora?.(modelo, tipo) ?? 0
        if (guion.modelosRetirados?.includes(modelo)) {
          return respuesta(404, { error: { code: 404, status: 'NOT_FOUND', message: `This model models/${modelo} is no longer available to new users. Please update your code to use models/gemini-3.6-flash for the latest features and improvements.` } })
        }
        const rechaza = guion.rechazaRazonamiento || guion.rechazaRazonamientoEn?.includes(modelo)
        if (rechaza && cuerpo.generationConfig.thinkingConfig) {
          return respuesta(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Thinking level is not supported for this model.' } })
        }
        const falla = guion.fallaGemini?.(tipo, modelo)
        if (falla) return respuesta(falla, { error: { message: 'falla simulada' } })
        const salida =
          tipo === 'nota' ? resolver(guion.nota, cuerpo)
          : tipo === 'tramo' ? resolver(guion.tramo, cuerpo)
          : tipo === 'minuta' ? resolver(guion.minuta, cuerpo)
          : tipo === 'prueba' ? { ok: true }
          : null
        if (!salida) throw new Error('La prueba no preparó una respuesta de Gemini para: ' + tipo)
        const uso = tipo === 'minuta' && guion.minutosDeAudio
          ? { promptTokensDetails: [{ modality: 'AUDIO', tokenCount: guion.minutosDeAudio * 60 * 32 }] }
          : undefined
        return respuesta(200, {
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(salida) }] } }],
          usageMetadata: uso,
        })
      }
      throw new Error('Pedido a Gemini inesperado: ' + url)
    },
  }

  // --- Lo demás ---
  function formatear(fecha: Date, zona: string, formato: string) {
    const partes = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(fecha.getTime())).map((p) => [p.type, p.value]),
    )
    return formato
      .replace('yyyy', partes.year).replace('MM', partes.month).replace('dd', partes.day)
      .replace('HH', partes.hour).replace('mm', partes.minute)
  }

  const globales = {
    console: { log: () => {}, error: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => { props.set(k, v) },
        deleteProperty: (k: string) => { props.delete(k) },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      formatDate: formatear,
      // Paraguay está en UTC-3 todo el año.
      parseDate: (texto: string, _zona: string, formato: string) => {
        const [fecha, hora = '00:00'] = formato.includes('HH') ? texto.split(' ') : [texto]
        return new contexto.Date(`${fecha}T${hora}:00-03:00`)
      },
      getUuid: () => randomUUID(),
      base64Encode: (bytes: number[]) => Buffer.from(bytes).toString('base64'),
      sleep: () => {},
    },
    ScriptApp: {
      getOAuthToken: () => 'token-de-prueba',
      // Google devuelve una copia: borrar mientras se recorre no saltea ninguna.
      getProjectTriggers: () => [...disparadores],
      deleteTrigger: (t: any) => { disparadores.splice(disparadores.indexOf(t), 1) },
      newTrigger: (f: string) => {
        const t: any = { funcion: f, config: [], getHandlerFunction: () => f }
        const c: any = {}
        ;['timeBased', 'everyMinutes', 'atHour', 'everyDays', 'inTimezone'].forEach((m) => {
          c[m] = (...a: any[]) => { t.config.push([m, ...a]); return c }
        })
        c.create = () => { disparadores.push(t); return t }
        return c
      },
    },
    MailApp: { sendEmail: (m: any) => { correos.push(m) } },
    SpreadsheetApp, DriveApp, DocumentApp, UrlFetchApp, Session, CalendarApp, Tasks, CacheService,
  }

  contexto = vm.createContext(globales)
  // El reloj del script queda fijo: "hoy" es siempre el mismo día en las pruebas.
  contexto.__ahora = () => ahora
  vm.runInContext(
    `const __Real = Date;
     class __Fija extends __Real {
       constructor(...a) { if (a.length) { super(...a) } else { super(__ahora()) } }
       static now() { return __ahora() }
     }
     Date = __Fija;`,
    contexto,
  )
  vm.runInContext(armar(), contexto, { filename: 'Asistente.gs' })

  return {
    ctx: contexto,
    correos,
    pedidosGemini,
    disparadores,
    props,
    documentos,
    archivos,
    carpetas,
    /** Pone un audio en Chat, como si alguien lo hubiera adjuntado. */
    subirAChat(bytes: number, tipo = 'audio/mp4') {
      const recurso = 'adjunto/' + randomUUID().slice(0, 8)
      medios.set(recurso, { bytes: Buffer.alloc(bytes, 7), tipo })
      return { contentType: tipo, contentName: 'grabacion', attachmentDataRef: { resourceName: recurso } }
    },
    eventos,
    DUENIO,
    /** Adelanta el reloj del script. */
    avanzar(ms: number) {
      ahora += ms
    },
    /** La lista de Google Tasks de una persona. */
    tasksDe: (email: string) => [...listaDe(email).values()],
    /** Corre algo con la cuenta de otra persona, como lo hace Chat. */
    comoUsuario<T>(email: string, fn: () => T): T {
      const antes = usuario
      usuario = email
      try {
        return fn()
      } finally {
        usuario = antes
      }
    },
    hoja(nombre: string) {
      return SpreadsheetApp.openById(props.get('BASE_ID')!).getSheetByName(nombre).filas
    },
    llamar(funcion: string, ...args: any[]) {
      contexto.__args = args
      return vm.runInContext(`${funcion}(...__args)`, contexto)
    },
  }
}

/** Un mensaje de Chat en formato clásico. */
export function mensaje(quien: { nombre: string; email: string }, texto: string, adjuntos: any[] = []) {
  return {
    type: 'MESSAGE',
    user: { displayName: quien.nombre, email: quien.email },
    space: { type: 'DM', spaceType: 'DIRECT_MESSAGE' },
    message: { text: texto, argumentText: texto, attachment: adjuntos },
  }
}
