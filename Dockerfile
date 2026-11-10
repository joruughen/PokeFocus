# PokeFocus: client (Vite build) + API (Hono on Node, run with tsx) in one image.
# Build:  docker build -t pokefocus .      Run: see docker-compose.yml

# ---- build the client --------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime -----------------------------------------------------------------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The server runs from TypeScript sources (tsx) and shares the engine with the client.
COPY server ./server
COPY src/engine ./src/engine
COPY src/game ./src/game
COPY src/data ./src/data
# The balance simulator: the admin "simulate draft" worker (server/content/simWorker.ts) runs it.
COPY scripts/sim ./scripts/sim
COPY --from=build /app/dist ./dist
# .data/uploads is the mount point of the `uploads` volume (event images): it must exist and belong to node
# in the image so a fresh named volume inherits that ownership.
RUN mkdir -p .data/uploads && chown -R node:node .data
USER node
EXPOSE 8787
CMD ["npm", "start"]
