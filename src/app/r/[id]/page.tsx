import { notFound } from 'next/navigation'
import Detalle from '@/components/Detalle'
import { sesionActual } from '@/lib/session'
import { leer } from '@/lib/store'

export default async function Reunion({ params }: { params: Promise<{ id: string }> }) {
  const s = await sesionActual()
  const { id } = await params
  const g = await leer(id)
  if (!s || !g || g.usuario !== s.email) notFound()
  return <Detalle inicial={g} />
}
