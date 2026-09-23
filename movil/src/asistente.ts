import type { Pedir } from './subida'

/**
 * Hablar con la aplicación web del Asistente. Apps Script contesta un POST
 * con una redirección a la respuesta, y fetch la sigue sola.
 */
export function conectar(url: string, esperaMs = 120000): Pedir {
  return async (cuerpo) => {
    const corte = new AbortController()
    const reloj = setTimeout(() => corte.abort(), esperaMs)
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(cuerpo),
        signal: corte.signal,
      })
      const texto = await r.text()
      try {
        return JSON.parse(texto)
      } catch {
        // Una página de Google en vez de una respuesta: la dirección está mal
        // o la aplicación web no está publicada para cualquiera.
        throw new Error(r.status === 200 ? 'La dirección no es la del Asistente.' : 'El Asistente contestó ' + r.status + '.')
      }
    } finally {
      clearTimeout(reloj)
    }
  }
}

/** Una dirección de aplicación web de Apps Script, sin espacios de más. */
export function direccionValida(url: string): boolean {
  return /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+\/|macros\/)s\/[\w-]+\/exec$/.test(url.trim())
}
