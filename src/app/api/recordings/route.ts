import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { exigirSesion } from '@/lib/session'
import { guardar, listar } from '@/lib/store'
import type { Grabacion } from '@/lib/types'

export async function GET() {
  const s = await exigirSesion()
  const mias = await listar(s.email)
  // La lista no lleva transcripcion ni minuta: en un telefono eso son megas al
  // pedo. El detalle se pide de a una.
  return NextResponse.json(
    mias.map(({ transcripcion, minuta, ...resto }) => ({
      ...resto,
      participantes: minuta?.participantes.map((p) => p.nombre) ?? [],
    })),
  )
}

export async function POST(pedido: NextRequest) {
  const s = await exigirSesion()
  const cuerpo = (await pedido.json().catch(() => ({}))) as {
    titulo?: string
    mimeType?: string
    participantes?: string[]
  }

  const ahora = new Date()
  const g: Grabacion = {
    id: randomUUID(),
    usuario: s.email,
    titulo: cuerpo.titulo?.trim() || `Reunión del ${ahora.toLocaleDateString('es-PY')}`,
    estado: 'grabando',
    creadaEn: ahora.toISOString(),
    cerradaEn: null,
    duracionSeg: 0,
    mimeType: cuerpo.mimeType ?? 'audio/webm',
    chunks: 0,
    bytes: 0,
    // Quien graba siempre estuvo en la reunion: es el primer nombre conocido.
    participantesPrevios: [s.nombre, ...(cuerpo.participantes ?? [])].filter(Boolean),
    transcripcion: null,
    minuta: null,
    drive: null,
    error: null,
  }
  await guardar(g)
  return NextResponse.json({ id: g.id, titulo: g.titulo })
}
