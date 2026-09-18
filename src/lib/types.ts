export type Estado =
  | 'grabando'
  | 'subida_incompleta'
  | 'en_cola'
  | 'transcribiendo'
  | 'resumiendo'
  | 'subiendo'
  | 'listo'
  | 'error'

/** Un turno de habla tal como lo devuelve el transcriptor: sin nombre todavia. */
export interface Turno {
  hablante: number
  desde: number
  hasta: number
  texto: string
}

export interface Transcripcion {
  idioma: string
  turnos: Turno[]
  duracionSeg: number
}

/** Alguien que estuvo en la reunion. `hablante` es el indice de diarizacion, si se pudo atar. */
export interface Participante {
  nombre: string
  hablante: number | null
  /** calendario = del evento; dicho = el modelo lo dedujo del audio; confirmado = lo dijo una persona. */
  origen: 'calendario' | 'dicho' | 'confirmado'
  rol?: string
}

export interface Compromiso {
  que: string
  duenio: string | null
  plazo: string | null
}

export interface Minuta {
  titulo: string
  resumen: string
  participantes: Participante[]
  decisiones: string[]
  compromisos: Compromiso[]
  preguntasAbiertas: string[]
  riesgos: string[]
  temas: string[]
}

export interface Grabacion {
  id: string
  usuario: string
  titulo: string
  estado: Estado
  creadaEn: string
  cerradaEn: string | null
  duracionSeg: number
  mimeType: string
  chunks: number
  bytes: number
  participantesPrevios: string[]
  transcripcion: Transcripcion | null
  minuta: Minuta | null
  drive: { carpetaId: string; audioId: string; minutaId: string } | null
  error: string | null
}
