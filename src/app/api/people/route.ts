import { NextResponse, type NextRequest } from 'next/server'
import { agregarPersona, listarPersonas } from '@/lib/personas'

export async function GET() {
  return NextResponse.json(await listarPersonas())
}

export async function POST(pedido: NextRequest) {
  const { nombre, rol } = (await pedido.json()) as { nombre?: string; rol?: string }
  if (!nombre?.trim()) {
    return NextResponse.json({ error: 'Falta el nombre' }, { status: 400 })
  }
  return NextResponse.json(await agregarPersona(nombre, { rol: rol ?? null }))
}
