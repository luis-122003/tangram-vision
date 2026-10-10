# Backend Node de Tangram IA. Se construye desde la raíz del repositorio
# (docker compose lo hace así) porque necesita el catálogo semilla, que vive en
# vision-service/data/.

# ─── Compilación ─────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ─── Imagen final: solo dependencias de producción y el compilado ────────────
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY backend/scripts ./scripts
# El catálogo con el que se siembra una base nueva. Ver `figurasSeed` en config.ts.
COPY vision-service/data/figures_seed.json ./data/figures_seed.json
ENV FIGURES_SEED=data/figures_seed.json

USER node
EXPOSE 8000
# La sonda llega por HTTP desde dentro del contenedor. Con FORCE_HTTPS el backend
# la redirigiría, así que se presenta como lo haría Caddy, que ya terminó el TLS.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/health',{headers:{'x-forwarded-proto':'https'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
