# Multi-stage Dockerfile for TokenCircuit Gateway & Web Studio

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig*.json tsup.config.ts ./
COPY src/ ./src/

RUN npm ci
RUN npm run build

# Production Runner
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=50098
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/tokencircuit.db

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
COPY circuit.config.json ./

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 50098

CMD ["node", "bin/tokencircuit.js", "serve", "--port", "50098"]
