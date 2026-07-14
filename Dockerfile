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
# Stage 2: Builder — type-check the workspace and build frontend assets
# ============================================================
FROM dev AS builder
RUN npm run build

# ============================================================
# Stage 3: Production — minimal runtime image
# ============================================================
FROM node:20-alpine AS production
WORKDIR /app

# Copy built artifacts and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Production defaults (override via docker-compose / -e flags)
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3001

EXPOSE 3001 4173

# Default command: start the trading API server
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
