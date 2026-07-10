# ============================================================
# Stage 1: Dev base — all dependencies installed, no build
# Used by docker-compose dev profile for hot-reload
# ============================================================
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# ============================================================
# Stage 2: Builder — compile backend TS + build frontend
# ============================================================
FROM dev AS builder
# Build frontend (Vite -> dist/)
RUN npx vite build
# Build backend: compile TypeScript -> server-dist/
# Override noEmit & composite from tsconfig.server.json
RUN echo '{"extends":"./tsconfig.server.json","compilerOptions":{"noEmit":false,"composite":false,"outDir":"server-dist"}}' > tsconfig.build.json \
    && npx tsc -p tsconfig.build.json \
    && rm tsconfig.build.json

# ============================================================
# Stage 3: Production — minimal runtime image
# ============================================================
FROM node:20-alpine AS production
WORKDIR /app

# Copy built artifacts and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server-dist ./server-dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Production defaults (override via docker-compose / -e flags)
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3001

EXPOSE 3001 4173

# Default command: start the trading API server
CMD ["node", "server-dist/server/index.js"]
