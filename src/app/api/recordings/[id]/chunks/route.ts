import { NextResponse, type NextRequest } from 'next/server'
import { guardarTrozo, trozosRecibidos } from '@/lib/blobs'
import { exigirSesion } from '@/lib/session'
import { actualizar, leer } from '@/lib/store'

/**
 * Recibe un trozo de audio mientras la reunion sigue. Es idempotente a proposito:
 * si el telefono pierde la red y reintenta el trozo 37, se reescribe el 37 y no
 * se duplica nada.
 */
export async function PUT(
  pedido: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const s = await exigirSesion()
  const { id } = await ctx.params
  const g = await leer(id)
  if (!g || g.usuario !== s.email) {
    return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
  }

  const indice = Number.parseInt(pedido.nextUrl.searchParams.get('i') ?? '', 10)
  if (!Number.isInteger(indice) || indice < 0) {
    return NextResponse.json({ error: 'Falta el indice del trozo' }, { status: 400 })
  }

  const datos = Buffer.from(await pedido.arrayBuffer())
  if (datos.byteLength === 0) {
    return NextResponse.json({ error: 'Trozo vacio' }, { status: 400 })
  }
  await guardarTrozo(id, indice, datos)

  const recibidos = await trozosRecibidos(id)
  const bytes = Number.parseInt(pedido.headers.get('x-duracion-seg') ?? '0', 10)
  await actualizar(id, (x) => ({
    ...x,
    chunks: recibidos.length,
    bytes: x.bytes + datos.byteLength,
    duracionSeg: Number.isFinite(bytes) && bytes > x.duracionSeg ? bytes : x.duracionSeg,
  }))

  return NextResponse.json({ recibidos: recibidos.length })
}
