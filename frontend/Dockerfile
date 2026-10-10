# Web de Tangram IA servida por Caddy, que además termina el HTTPS y reenvía
# /api/* al backend. Se construye desde la raíz del repositorio.

# ─── Compilación ─────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# La dirección de la API queda fijada al compilar: la usa el código y la CSP.
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "Falta VITE_API_URL" && exit 1)
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ─── Imagen final: Caddy con los estáticos ───────────────────────────────────
FROM caddy:2.10-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
