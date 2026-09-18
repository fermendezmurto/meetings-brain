import { NextResponse, type NextRequest } from 'next/server'
import { procesar } from '@/lib/pipeline'
import { exigirSesion } from '@/lib/session'
import { actualizar, leer } from '@/lib/store'

/**
 * Cierra la grabacion y arranca el procesamiento. Contesta enseguida: el
 * telefono no tiene por que quedarse esperando a que termine la transcripcion
 * de una reunion de dos horas.
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
  if (g.chunks === 0) {
    return NextResponse.json({ error: 'No llego nada de audio' }, { status: 400 })
  }

  const cuerpo = (await pedido.json().catch(() => ({}))) as {
    duracionSeg?: number
    titulo?: string
  }

  await actualizar(id, (x) => ({
    ...x,
    estado: 'en_cola',
    cerradaEn: new Date().toISOString(),
    duracionSeg: cuerpo.duracionSeg ?? x.duracionSeg,
    titulo: cuerpo.titulo?.trim() || x.titulo,
  }))

  // Sin await: el trabajo sigue en segundo plano y el estado queda en la ficha.
  // En produccion esto pasa a una cola de verdad para sobrevivir a un reinicio.
  void procesar(id, s.sid).catch(() => {})

  return NextResponse.json({ ok: true, estado: 'en_cola' })
}
