import { NextResponse, type NextRequest } from 'next/server'
import { agregarPersona } from '@/lib/personas'
import { exigirSesion } from '@/lib/session'
import { confirmarHablante } from '@/lib/speakers'
import { actualizar, leer } from '@/lib/store'

/**
 * Le pone nombre a una voz. Esta es la pieza que hace que el sistema aprenda:
 * cada confirmacion de una persona vale mas que lo que dedujo el modelo, y es la
 * que manana sirve para reconocer esa voz sola.
 */
export async function POST(
  pedido: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const s = await exigirSesion()
  const { id } = await ctx.params
  const g = await leer(id)
  if (!g || g.usuario !== s.email) {
    return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
  }
  if (!g.minuta) {
    return NextResponse.json({ error: 'La minuta todavia no esta' }, { status: 409 })
  }

  const { hablante, nombre } = (await pedido.json()) as {
    hablante?: number
    nombre?: string
  }
  if (!Number.isInteger(hablante)) {
    return NextResponse.json({ error: 'Falta el numero de hablante' }, { status: 400 })
  }

  // Un nombre que una persona confirmo vale para toda la empresa: entra a la
  // lista y queda disponible para elegir en la proxima reunion.
  if (nombre?.trim()) await agregarPersona(nombre)

  const actualizada = await actualizar(id, (x) => ({
    ...x,
    minuta: x.minuta && {
      ...x.minuta,
      participantes: confirmarHablante(
        x.minuta.participantes,
        hablante as number,
        nombre ?? '',
      ),
    },
  }))
  return NextResponse.json(actualizada?.minuta?.participantes ?? [])
}
