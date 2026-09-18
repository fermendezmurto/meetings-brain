import { jwtVerify } from 'jose'
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE } from '@/lib/cookie'

/**
 * Corta el paso antes de llegar a las rutas. La sesion se valida una sola vez
 * aca y no en cada handler, asi no queda ninguna ruta sin proteger por olvido.
 */
export async function middleware(pedido: NextRequest) {
  const bruta = pedido.cookies.get(COOKIE)?.value
  let valida = false
  if (bruta) {
    const secreto =
      process.env.SESSION_SECRET?.trim() ||
      (process.env.GOOGLE_CLIENT_ID ? '' : 'clave-de-prueba-local')
    try {
      await jwtVerify(bruta, new TextEncoder().encode(secreto))
      valida = true
    } catch {
      valida = false
    }
  }
  if (valida) return NextResponse.next()

  if (pedido.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Hay que iniciar sesion' }, { status: 401 })
  }
  return NextResponse.redirect(new URL('/', pedido.url))
}

export const config = {
  matcher: ['/api/recordings/:path*', '/grabar', '/r/:path*'],
}
