/**
 * Bytes a base64, sin depender de btoa: una parte de 4 MB pasada a texto
 * carácter por carácter es lenta en el teléfono, y así se hace de una.
 */
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function aBase64(bytes: Uint8Array): string {
  const salida: string[] = []
  // De a bloques, para no armar un string gigante de a un carácter.
  const BLOQUE = 3 * 4096
  for (let inicio = 0; inicio < bytes.length; inicio += BLOQUE) {
    const fin = Math.min(inicio + BLOQUE, bytes.length)
    let trozo = ''
    let i = inicio
    for (; i + 2 < fin; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
      trozo += LETRAS[n >> 18] + LETRAS[(n >> 12) & 63] + LETRAS[(n >> 6) & 63] + LETRAS[n & 63]
    }
    const resto = fin - i
    if (resto === 1) {
      const n = bytes[i] << 16
      trozo += LETRAS[n >> 18] + LETRAS[(n >> 12) & 63] + '=='
    } else if (resto === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
      trozo += LETRAS[n >> 18] + LETRAS[(n >> 12) & 63] + LETRAS[(n >> 6) & 63] + '='
    }
    salida.push(trozo)
  }
  return salida.join('')
}
