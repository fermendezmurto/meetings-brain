import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Reuniones',
  description: 'Grabar reuniones, transcribirlas y dejar la minuta en Drive.',
  manifest: '/manifest.webmanifest',
}

export const viewport: Viewport = {
  themeColor: '#0d1117',
  // La app se usa con el telefono en la mano arriba de la mesa: nada de zoom
  // accidental mientras corre la grabacion.
  maximumScale: 1,
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
