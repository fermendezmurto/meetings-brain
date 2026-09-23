# Imagen para cualquier hosting de contenedores (Railway, Render, Fly, una VM).
# Necesita un disco montado en /datos: ahi viven el audio y las fichas, y si
# quedan dentro del contenedor cada despliegue se las lleva puestas.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/datos
ENV PORT=3000
# Docker define HOSTNAME solo, con el id del contenedor, y el servidor de Next
# intenta escuchar justo ahi: el servicio arranca pero queda inalcanzable desde
# afuera. Forzarlo a 0.0.0.0 es lo que lo hace visible.
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S next -u 1001 \
    && mkdir -p /datos && chown next:nodejs /datos

COPY --from=builder /app/public ./public
COPY --from=builder --chown=next:nodejs /app/.next/standalone ./
COPY --from=builder --chown=next:nodejs /app/.next/static ./.next/static

USER next
EXPOSE 3000
CMD ["node", "server.js"]
