# Build the client bundle and the server bundle.
FROM node:22-alpine AS build
WORKDIR /app

# Install with the lockfile so the image matches what was tested.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production dependencies only, resolved separately so the final image
# carries no build tooling.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# esbuild bundles src/server/main.ts with --packages=external, so runtime deps are needed.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# node:alpine ships a non-root "node" user. Run as it rather than root.
USER node

# Container Apps injects PORT; this is the local default.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.cjs"]
