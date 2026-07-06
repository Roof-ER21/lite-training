# lite-training-24 — self-host image (Railway used Nixpacks; this is the portable equivalent).
FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# server tsc is small here; if it ever OOMs, add: ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build
EXPOSE 3000
CMD ["node", "dist-server/index.js"]
