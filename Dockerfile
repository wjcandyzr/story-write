# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
# `npm install` (not `ci`) because we don't ship a lockfile in this scaffold.
RUN npm install --no-audit --no-fund

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main.js"]
