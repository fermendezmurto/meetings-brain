import Link from 'next/link'
import { config, enModoPrueba } from '@/lib/config'
import { sesionActual } from '@/lib/session'
import { listar } from '@/lib/store'
import { reloj } from '@/lib/speakers'
import type { Estado } from '@/lib/types'

const ETIQUETA: Record<Estado, string> = {
  grabando: 'Grabando',
  subida_incompleta: 'Subida incompleta',
  en_cola: 'En cola',
  transcribiendo: 'Transcribiendo',
  resumiendo: 'Escribiendo la minuta',
  subiendo: 'Subiendo a Drive',
  listo: 'Lista',
  error: 'Con error',
}

export default async function Inicio({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const s = await sesionActual()
  const { error } = await searchParams

  if (!s) {
    return (
      <>
        <h1>Reuniones</h1>
        <p className="suave">
          Grabá la reunión desde el teléfono. Al terminar queda la transcripción y la
          minuta en Drive, sin que tengas que hacer nada más.
        </p>
        {error && <p className="aviso">{error}</p>}
        <div className="panel">
          <a className="boton" href="/api/auth/login">
            {enModoPrueba() ? 'Entrar en modo de prueba' : 'Entrar con Google'}
          </a>
          {config.dominioPermitido && (
            <p className="suave" style={{ marginTop: 12, marginBottom: 0 }}>
              Solo para cuentas de {config.dominioPermitido}.
            </p>
          )}
        </div>
      </>
    )
  }

  const mias = await listar(s.email)

  return (
    <>
      <div className="fila" style={{ justifyContent: 'space-between' }}>
        <h1>Mis reuniones</h1>
        <form action="/api/auth/logout" method="post">
          <button className="boton secundario" style={{ width: 'auto', padding: '6px 12px' }}>
            Salir
          </button>
        </form>
      </div>
      <p className="suave">{s.nombre}</p>

      <Link className="boton" href="/grabar" style={{ margin: '16px 0 24px' }}>
        Grabar una reunión
      </Link>

      {mias.length === 0 ? (
        <p className="suave">Todavía no grabaste ninguna.</p>
      ) : (
        <ul className="lista">
          {mias.map((g) => (
            <li key={g.id}>
              <Link href={`/r/${g.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <strong>{g.titulo}</strong>
                <div className="suave">
                  {new Date(g.creadaEn).toLocaleString('es-PY')} · {reloj(g.duracionSeg)} ·{' '}
                  {ETIQUETA[g.estado]}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
