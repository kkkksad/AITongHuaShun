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
# Stage 3: Web — static frontend served by Nginx
# ============================================================
FROM nginx:1.27-alpine AS web
COPY --from=builder /app/dist /usr/share/nginx/html
# The deployment archive can retain restrictive Windows source modes for files
# copied from public/. Nginx must be able to read every generated asset.
RUN find /usr/share/nginx/html -type d -exec chmod 0755 {} + \
    && find /usr/share/nginx/html -type f -exec chmod 0644 {} +

# ============================================================
# Stage 4: Production — minimal API runtime image
# ============================================================
FROM node:20-alpine AS production
WORKDIR /app

# Copy built artifacts and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Production defaults (override via docker-compose / -e flags)
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3001

EXPOSE 3001 4173

# Default command: start the trading API server
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
