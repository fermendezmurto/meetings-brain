function texto(clave: string, porDefecto = ''): string {
  return process.env[clave]?.trim() || porDefecto
}

function obligatorio(clave: string): string {
  const v = texto(clave)
  if (!v) throw new Error(`Falta la variable de entorno ${clave}`)
  return v
}

export const config = {
  appUrl: texto('APP_URL', 'http://localhost:3000'),
  dominioPermitido: texto('ALLOWED_DOMAIN'),
  get googleClientId() {
    return obligatorio('GOOGLE_CLIENT_ID')
  },
  get googleClientSecret() {
    return obligatorio('GOOGLE_CLIENT_SECRET')
  },
  get sessionSecret() {
    // Sin credenciales de Google la app corre en modo de prueba: ahi una clave
    // fija evita tener que configurar nada para levantarla.
    if (!process.env.SESSION_SECRET && enModoPrueba()) return 'clave-de-prueba-local'
    return obligatorio('SESSION_SECRET')
  },
  transcriptor: texto('TRANSCRIBER', 'mock'),
  resumidor: texto('SUMMARIZER', 'mock'),
  geminiKey: texto('GEMINI_API_KEY'),
  geminiModelo: texto('GEMINI_MODEL', 'gemini-2.5-flash'),
  deepgramKey: texto('DEEPGRAM_API_KEY'),
  assemblyaiKey: texto('ASSEMBLYAI_API_KEY'),
  destino: texto('UPLOADER', 'mock'),
  driveRaizId: texto('DRIVE_ROOT_FOLDER_ID'),
  /** Dias que se conserva el audio crudo antes de borrarlo. La minuta queda siempre. */
  retencionAudioDias: Number.parseInt(texto('AUDIO_RETENTION_DAYS', '90'), 10),
}

/** true cuando la app corre sin credenciales, contra los adaptadores de prueba. */
export function enModoPrueba(): boolean {
  return !process.env.GOOGLE_CLIENT_ID
}
