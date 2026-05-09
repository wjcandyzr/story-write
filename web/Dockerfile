# ---- builder ----
# 编译 Vue + TS,产物在 /app/dist
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
# 用 ci 而不是 install,严格按 lock 文件,跨机器一致
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- runtime ----
# 用 nginx 同时干两件事:
#   1. 服务编译好的 SPA 静态文件
#   2. /api 与 /socket.io 反代到 api 容器
FROM nginx:alpine AS runtime
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
