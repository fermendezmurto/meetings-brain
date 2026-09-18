'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Estado = 'inicio' | 'pidiendo' | 'grabando' | 'pausada' | 'cerrando'

/** Cada cuanto se corta un trozo y se manda. Mas corto = se pierde menos si algo falla. */
const TROZO_MS = 30_000

/**
 * Contenedores en orden de preferencia. Safari en iPhone no sabe webm y solo
 * acepta mp4, asi que hay que negociar en vez de asumir.
 */
const FORMATOS = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
]

function formatoSoportado(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return FORMATOS.find((f) => MediaRecorder.isTypeSupported(f)) ?? ''
}

export default function Grabador() {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>('inicio')
  const [titulo, setTitulo] = useState('')
  const [invitados, setInvitados] = useState('')
  const [segundos, setSegundos] = useState(0)
  const [pendientes, setPendientes] = useState(0)
  const [error, setError] = useState('')

  const grabacionId = useRef<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const pista = useRef<MediaStream | null>(null)
  const proximoIndice = useRef(0)
  const cola = useRef<{ indice: number; datos: Blob }[]>([])
  const subiendo = useRef(false)
  const wakeLock = useRef<WakeLockSentinel | null>(null)

  /**
   * Sube los trozos de a uno y en orden, reintentando con espera creciente.
   * Mientras la cola no se vacie, la grabacion no se puede cerrar: esa es toda
   * la garantia de que no se pierde audio.
   */
  const vaciarCola = useCallback(async () => {
    if (subiendo.current) return
    subiendo.current = true
    try {
      while (cola.current.length > 0) {
        const trozo = cola.current[0]
        let mandado = false
        for (let intento = 0; intento < 6 && !mandado; intento++) {
          try {
            const r = await fetch(
              `/api/recordings/${grabacionId.current}/chunks?i=${trozo.indice}`,
              { method: 'PUT', body: trozo.datos },
            )
            if (!r.ok) throw new Error(String(r.status))
            mandado = true
          } catch {
            // 1s, 2s, 4s, 8s, 16s: da tiempo a que vuelva el wifi del salon.
            await new Promise((r) => setTimeout(r, 1000 * 2 ** intento))
          }
        }
        if (!mandado) {
          setError('No se pudo subir un tramo. Seguí grabando: se reintenta al cerrar.')
          break
        }
        cola.current.shift()
        setPendientes(cola.current.length)
      }
    } finally {
      subiendo.current = false
    }
  }, [])

  const arrancar = useCallback(async () => {
    setError('')
    setEstado('pidiendo')
    try {
      const formato = formatoSoportado()
      if (!formato) throw new Error('Este navegador no puede grabar audio.')

      const medios = await navigator.mediaDevices.getUserMedia({
        audio: {
          // En una sala, cancelar eco y ruido se come a los que estan lejos de
          // la mesa. Para reunion presencial conviene el audio crudo.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      })
      pista.current = medios

      const r = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          titulo,
          mimeType: formato,
          participantes: invitados
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      })
      if (!r.ok) throw new Error('No se pudo abrir la grabación.')
      grabacionId.current = ((await r.json()) as { id: string }).id

      const mr = new MediaRecorder(medios, { mimeType: formato, audioBitsPerSecond: 48_000 })
      mr.ondataavailable = (e) => {
        if (e.data.size === 0) return
        cola.current.push({ indice: proximoIndice.current++, datos: e.data })
        setPendientes(cola.current.length)
        void vaciarCola()
      }
      mr.start(TROZO_MS)
      recorder.current = mr
      setEstado('grabando')

      // Sin esto la pantalla se apaga y el navegador puede suspender la captura.
      try {
        wakeLock.current = await navigator.wakeLock?.request('screen')
      } catch {
        // No todos los navegadores lo tienen. No es motivo para no grabar.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo empezar a grabar.')
      setEstado('inicio')
    }
  }, [titulo, invitados, vaciarCola])

  const terminar = useCallback(async () => {
    setEstado('cerrando')
    const mr = recorder.current
    if (mr && mr.state !== 'inactive') {
      // El ultimo trozo llega en este stop: hay que esperarlo antes de cerrar.
      await new Promise<void>((listo) => {
        mr.onstop = () => listo()
        mr.stop()
      })
    }
    pista.current?.getTracks().forEach((t) => t.stop())
    await wakeLock.current?.release().catch(() => {})

    await vaciarCola()
    if (cola.current.length > 0) {
      setError('Quedaron tramos sin subir. No cierres la pantalla todavía.')
      setEstado('pausada')
      return
    }

    const r = await fetch(`/api/recordings/${grabacionId.current}/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ duracionSeg: segundos, titulo }),
    })
    if (!r.ok) {
      setError('No se pudo cerrar la grabación.')
      setEstado('pausada')
      return
    }
    router.push(`/r/${grabacionId.current}`)
  }, [router, segundos, titulo, vaciarCola])

  // Reloj.
  useEffect(() => {
    if (estado !== 'grabando') return
    const t = setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [estado])

  // Si el navegador suelta el wake lock al volver de segundo plano, se repide.
  useEffect(() => {
    const alVolver = async () => {
      if (document.visibilityState === 'visible' && estado === 'grabando') {
        try {
          wakeLock.current = await navigator.wakeLock?.request('screen')
        } catch {
          /* sin wake lock se sigue grabando igual */
        }
      }
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [estado])

  // Aviso antes de cerrar la pestania con audio sin subir.
  useEffect(() => {
    const avisar = (e: BeforeUnloadEvent) => {
      if (estado === 'grabando' || estado === 'pausada' || cola.current.length > 0) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [estado])

  if (estado === 'inicio' || estado === 'pidiendo') {
    return (
      <>
        <h1>Nueva reunión</h1>
        <div className="panel">
          <p className="suave">Título (opcional)</p>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Revisión semanal de producto"
          />
          <p className="suave" style={{ marginTop: 16 }}>
            Quiénes están, separados por coma (opcional)
          </p>
          <input
            value={invitados}
            onChange={(e) => setInvitados(e.target.value)}
            placeholder="Juan Antonio, Diana, Christian"
          />
          <p className="suave" style={{ marginTop: 8, marginBottom: 0 }}>
            Poner los nombres ayuda a que la minuta sepa quién dijo qué.
          </p>
        </div>
        {error && <p className="aviso">{error}</p>}
        <button className="boton" onClick={arrancar} disabled={estado === 'pidiendo'}>
          {estado === 'pidiendo' ? 'Pidiendo el micrófono…' : 'Empezar a grabar'}
        </button>
        <p className="suave" style={{ marginTop: 16 }}>
          Avisá a los presentes que la reunión se está grabando.
        </p>
      </>
    )
  }

  return (
    <>
      <h1>{titulo || 'Grabando'}</h1>
      <div className="reloj">{formatoReloj(segundos)}</div>
      <p className="suave" style={{ textAlign: 'center' }}>
        {estado === 'grabando' && <span className="punto" />}
        {estado === 'cerrando' ? 'Cerrando…' : 'En curso'}
        {pendientes > 0 && ` · ${pendientes} ${pendientes === 1 ? 'tramo' : 'tramos'} por subir`}
      </p>
      {error && <p className="aviso">{error}</p>}
      <button className="boton peligro" onClick={terminar} disabled={estado === 'cerrando'}>
        Terminar reunión
      </button>
      <p className="suave" style={{ marginTop: 16 }}>
        Dejá esta pantalla abierta. El audio se va subiendo cada 30 segundos, así que
        si el teléfono se apaga no se pierde lo grabado hasta ahí.
      </p>
    </>
  )
}

function formatoReloj(s: number): string {
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(Math.floor(s / 3600))}:${dos(Math.floor((s % 3600) / 60))}:${dos(s % 60)}`
}
