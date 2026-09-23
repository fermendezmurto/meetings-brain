'use client'

import { useEffect, useState } from 'react'
import type { Persona } from '@/lib/personas'

/**
 * Elegir quienes estan tocando nombres, en vez de escribirlos separados por
 * coma en cada reunion. La lista se arma sola con quien usa la app y con los
 * nombres que se confirman al corregir las voces, asi que nadie tiene que
 * mantener una nomina.
 *
 * El campo para sumar a alguien sigue estando porque a las reuniones tambien
 * va gente de afuera: clientes, proveedores, el estudio juridico.
 */
export default function SelectorPersonas({
  seleccionados,
  alCambiar,
}: {
  seleccionados: string[]
  alCambiar: (nombres: string[]) => void
}) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [nuevo, setNuevo] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/people')
        if (r.ok) setPersonas((await r.json()) as Persona[])
      } finally {
        setCargando(false)
      }
    })()
  }, [])

  function alternar(nombre: string) {
    alCambiar(
      seleccionados.includes(nombre)
        ? seleccionados.filter((n) => n !== nombre)
        : [...seleccionados, nombre],
    )
  }

  async function sumar() {
    const nombre = nuevo.replace(/\s+/g, ' ').trim()
    if (!nombre) return
    setNuevo('')

    // Se selecciona enseguida y se guarda en segundo plano: quien esta por
    // empezar una reunion no tiene por que esperar a que termine el pedido.
    if (!seleccionados.includes(nombre)) alCambiar([...seleccionados, nombre])

    const r = await fetch('/api/people', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nombre }),
    })
    if (r.ok) setPersonas((await r.json()) as Persona[])
  }

  // Alguien de afuera que se sumo recien y todavia no esta en la lista guardada.
  const sueltos = seleccionados.filter(
    (n) => !personas.some((p) => p.nombre === n),
  )

  return (
    <>
      <p className="suave">Quiénes están</p>

      {cargando ? (
        <p className="suave">Cargando…</p>
      ) : personas.length === 0 && sueltos.length === 0 ? (
        <p className="suave">
          Todavía no hay nadie cargado. Agregá los nombres acá abajo: la próxima vez
          ya van a estar para elegir.
        </p>
      ) : (
        <div className="fichas">
          {[...sueltos, ...personas.map((p) => p.nombre)].map((nombre) => (
            <button
              key={nombre}
              type="button"
              className={`ficha ${seleccionados.includes(nombre) ? 'elegida' : ''}`}
              aria-pressed={seleccionados.includes(nombre)}
              onClick={() => alternar(nombre)}
            >
              {nombre}
            </button>
          ))}
        </div>
      )}

      <div className="fila" style={{ marginTop: 12 }}>
        <input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void sumar()
            }
          }}
          placeholder="Agregar a alguien que no está"
        />
        <button
          type="button"
          className="boton secundario"
          style={{ width: 'auto', padding: '12px 16px' }}
          onClick={() => void sumar()}
          disabled={!nuevo.trim()}
        >
          Agregar
        </button>
      </div>
      <p className="suave" style={{ marginTop: 8, marginBottom: 0 }}>
        Marcar quiénes están ayuda a que la minuta sepa quién dijo qué.
      </p>
    </>
  )
}
