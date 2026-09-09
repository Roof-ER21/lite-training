# lite-training-24 — self-host image (Railway used Nixpacks; this is the portable equivalent).
FROM node:20-bookworm-slim
WORKDIR /app
# vendor/ holds the packed @omj21/mcp21 tarball that package.json references as
# file:vendor/…, so it must exist before npm ci. It is a RUNTIME dependency:
# build:server is plain tsc (no bundling), so dist-server imports it from node_modules.
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
# server tsc is small here; if it ever OOMs, add: ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build
EXPOSE 3000
CMD ["node", "dist-server/index.js"]
