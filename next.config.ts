import type { NextConfig } from 'next'

const config: NextConfig = {
  // Empaqueta el servidor con solo lo que usa: la imagen de Docker queda chica.
  output: 'standalone',
  // Los chunks de audio llegan por streaming al disco, no por el body parser.
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
}

export default config
