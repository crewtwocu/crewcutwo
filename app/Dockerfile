# Crew match app — Node 22 Alpine multi-stage (compile TS; no secrets in image)
FROM node:22-alpine AS build
WORKDIR /app

# better-sqlite3 native compile
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

# Runtime deps for better-sqlite3 native binding
RUN apk add --no-cache libstdc++ \
  && mkdir -p /app/data \
  && addgroup -S crew && adduser -S crew -G crew \
  && chown -R crew:crew /app

COPY --from=build --chown=crew:crew /app/node_modules ./node_modules
COPY --from=build --chown=crew:crew /app/dist ./dist
COPY --from=build --chown=crew:crew /app/package.json ./
COPY --from=build --chown=crew:crew /app/public ./public

ENV NODE_ENV=production \
    PORT=3847 \
    CREW_MOCK_ONLY=1 \
    PUBLIC_BASE_URL=http://localhost:3847 \
    DB_PATH=/app/data/crew.db

USER crew
EXPOSE 3847
CMD ["node", "dist/index.js"]
