import { NextResponse } from 'next/server'
import { exigirSesion } from '@/lib/session'
import { leer } from '@/lib/store'

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await exigirSesion()
  const { id } = await ctx.params
  const g = await leer(id)
  // Mismo 404 para "no existe" y "no es tuya": no hace falta confirmarle a nadie
  // que una grabacion ajena existe.
  if (!g || g.usuario !== s.email) {
    return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
  }
  return NextResponse.json(g)
}
