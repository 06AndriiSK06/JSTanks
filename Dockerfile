# --- Stage 1: Build workspace ---
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci

COPY tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client

RUN npm --workspace=@jstanks/shared run build && \
    npm --workspace=@jstanks/server run build && \
    npm --workspace=@jstanks/client run build

# --- Stage 2: Minimal non-root production runtime ---
FROM node:22-alpine AS runner
WORKDIR /app

ARG GIT_SHA=dev
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV STATIC_DIR=client/dist
ENV APP_VERSION=${GIT_SHA}

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

RUN mkdir -p /app/logs && chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "server/dist/index.js"]