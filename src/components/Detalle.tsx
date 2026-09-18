'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { reloj } from '@/lib/speakers'
import type { Estado, Grabacion } from '@/lib/types'

const PASOS: Record<Estado, string> = {
  grabando: 'Grabando',
  subida_incompleta: 'Faltan tramos de audio',
  en_cola: 'En cola',
  transcribiendo: 'Escuchando el audio…',
  resumiendo: 'Escribiendo la minuta…',
  subiendo: 'Guardando en Drive…',
  listo: 'Lista',
  error: 'Con error',
}

const EN_PROCESO: Estado[] = ['en_cola', 'transcribiendo', 'resumiendo', 'subiendo']

export default function Detalle({ inicial }: { inicial: Grabacion }) {
  const [g, setG] = useState(inicial)

  // Mientras se procesa se consulta el estado. Cuando termina, para: no tiene
  // sentido seguir golpeando el servidor desde un telefono.
  useEffect(() => {
    if (!EN_PROCESO.includes(g.estado)) return
    const t = setInterval(async () => {
      const r = await fetch(`/api/recordings/${g.id}`)
      if (r.ok) setG((await r.json()) as Grabacion)
    }, 4000)
    return () => clearInterval(t)
  }, [g.estado, g.id])

  async function confirmar(hablante: number, nombre: string) {
    const r = await fetch(`/api/recordings/${g.id}/speakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hablante, nombre }),
    })
    if (r.ok) {
      const participantes = (await r.json()) as Grabacion['minuta'] extends null
        ? never
        : NonNullable<Grabacion['minuta']>['participantes']
      setG((x) => ({ ...x, minuta: x.minuta && { ...x.minuta, participantes } }))
    }
  }

  const m = g.minuta

  return (
    <>
      <Link href="/" className="suave">
        ← Mis reuniones
      </Link>
      <h1 style={{ marginTop: 12 }}>{g.titulo}</h1>
      <p className="suave">
        {new Date(g.creadaEn).toLocaleString('es-PY')} · {reloj(g.duracionSeg)} ·{' '}
        {PASOS[g.estado]}
      </p>

      {EN_PROCESO.includes(g.estado) && (
        <div className="panel">
          <p style={{ margin: 0 }}>
            <span className="punto" />
            {PASOS[g.estado]}
          </p>
          <p className="suave" style={{ margin: '8px 0 0' }}>
            Podés cerrar esta pantalla. La minuta queda igual en Drive cuando termine.
          </p>
        </div>
      )}

      {g.estado === 'error' && (
        <div className="panel">
          <p className="aviso">{g.error}</p>
          <p className="suave" style={{ marginBottom: 0 }}>
            El audio está guardado. Se puede reintentar sin volver a grabar.
          </p>
        </div>
      )}

      {m && (
        <>
          <h2>Resumen</h2>
          <p>{m.resumen}</p>

          <h2>Quién habló</h2>
          <ul className="lista">
            {m.participantes.map((p) => (
              <li key={`${p.hablante}-${p.nombre}`}>
                <div className="fila" style={{ justifyContent: 'space-between' }}>
                  <span>
                    {p.nombre}
                    {p.rol && <span className="suave"> · {p.rol}</span>}
                  </span>
                  {p.origen === 'dicho' && p.hablante !== null && (
                    <button
                      className="boton secundario"
                      style={{ width: 'auto', padding: '4px 10px', fontSize: 14 }}
                      onClick={() => {
                        const nombre = prompt(`¿Quién es "${p.nombre}"?`, p.nombre)
                        if (nombre !== null) void confirmar(p.hablante!, nombre)
                      }}
                    >
                      Corregir
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="suave">
            Los nombres sin confirmar los dedujo el sistema de lo que se dijo. Corregirlos
            acá es lo que le enseña a reconocer cada voz.
          </p>

          <h2>Compromisos</h2>
          {m.compromisos.length === 0 ? (
            <p className="suave">Nadie se llevó trabajo.</p>
          ) : (
            <ul className="lista">
              {m.compromisos.map((c, i) => (
                <li key={i}>
                  {c.que}
                  <div className="suave">
                    {c.duenio ?? 'Sin dueño'} · {c.plazo ?? 'sin plazo'}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2>Decisiones</h2>
          {m.decisiones.length === 0 ? (
            <p className="suave">No se cerró ninguna.</p>
          ) : (
            <ul className="lista">
              {m.decisiones.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}

          {m.preguntasAbiertas.length > 0 && (
            <>
              <h2>Preguntas abiertas</h2>
              <ul className="lista">
                {m.preguntasAbiertas.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {g.drive && g.drive.minutaId !== 'local' && (
        <p style={{ marginTop: 24 }}>
          <a href={`https://drive.google.com/drive/folders/${g.drive.carpetaId}`}>
            Abrir la carpeta en Drive
          </a>
        </p>
      )}
    </>
  )
}
