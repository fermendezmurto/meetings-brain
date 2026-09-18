import type { NextConfig } from 'next'

const config: NextConfig = {
  // Los chunks de audio llegan por streaming al disco, no por el body parser.
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
}

export default config
