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
COPY --from=build /app/dist ./dist
RUN mkdir -p .data && chown node:node .data
USER node
EXPOSE 8787
CMD ["npm", "start"]
