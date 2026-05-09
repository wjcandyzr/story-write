# 部署指南 · 从 0 到 1

把 AI Novel 部署到一台空白 Linux 服务器,只需要 Docker。**不需要手装 Node、PostgreSQL、Redis,全部容器化**。

## 准备清单

| 资源 | 推荐 | 最低 |
| --- | --- | --- |
| 操作系统 | Ubuntu 22.04 / 24.04 LTS | 任何主流 Linux + Docker |
| RAM | 2 GB+ | 1 GB(够跑,LLM 调用是远程) |
| 磁盘 | 20 GB+ | 10 GB |
| 网络 | 公网 IP + 80/443 端口开放 | 局域网也能跑 |
| 域名 | 可选(没域名直接用 IP 也行) | — |
| API key | DeepSeek 或其他 OpenAI 兼容平台 | 必须 |

---

## 一、装系统依赖(只需要 Docker)

### Ubuntu / Debian

```bash
# 更新源
sudo apt update && sudo apt upgrade -y

# 装 git + 防火墙工具
sudo apt install -y git curl ufw

# 装 Docker (官方一键脚本)
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker

# 把当前用户加到 docker 组,免 sudo 跑 docker
sudo usermod -aG docker $USER
# 重新登录或者执行下面让 group 生效
newgrp docker

# 验证
docker --version
docker compose version
```

### 中国大陆服务器(可选:加速 Docker Hub)

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://registry.docker-cn.com",
    "https://mirror.baidubce.com",
    "https://docker.mirrors.ustc.edu.cn",
    "https://docker.1panel.live"
  ]
}
EOF
sudo systemctl restart docker
```

> 镜像源时常失效,有问题就换一个。`docker.1ms.run` / `docker.1panel.live` 目前比较稳。
> 验证:`docker pull hello-world` 看下载速度。

---

## 二、拉代码

```bash
cd /opt
sudo git clone https://github.com/wjcandyzr/story-write.git novel
sudo chown -R $USER:$USER /opt/novel
cd /opt/novel
```

放在 `/opt/novel` 是惯例,放别处也行。

---

## 三、配置 `.env`

```bash
cp .env.example .env
nano .env   # 或 vim
```

**至少**要改下面这几个:

```bash
# ===== 必填 =====

# 数据库密码(生产请用强随机)
DB_PASSWORD=换成强随机字符串

# JWT 签名密钥(至少 32 字符随机)
JWT_SECRET=换成 64 位以上的随机串

# DeepSeek (或其他 OpenAI 兼容 API) 的 key
OPENAI_API_KEY=sk-你的key
OPENAI_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat

# ===== 可选 =====

# 80 端口被占?改一下
PUBLIC_HTTP_PORT=80

# 章节生成相关参数,默认值通常够用
LLM_TIMEOUT_MS=180000
LLM_FAKE_STREAM=true
LLM_MAX_REWRITES=3
```

生成强随机密钥:

```bash
# 生成 32 字节 hex(64 字符)
openssl rand -hex 32
```

> **DB_SYNC 默认 true**,首次跑会自动建表,适合冷启动。等你想用 migration 流水时再改 `false` 并跑 `npm run migration:run`。

---

## 四、启动

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

第一次跑会:
1. 拉 postgres / redis / nginx / node 镜像
2. 构建 api 镜像(`npm install` + `nest build`)
3. 构建 web 镜像(`npm ci` + `vite build` + nginx)
4. 启动 4 个容器

**预计 5~10 分钟**,中国大陆没设镜像可能慢到 20+ 分钟。

启动完成后:

```bash
docker compose -f docker-compose.prod.yml ps
```

应该看到 4 个服务都是 `Up`,postgres / redis 状态 `healthy`。

```
NAME             STATUS
novel-postgres   Up 30 seconds (healthy)
novel-redis      Up 30 seconds (healthy)
novel-api        Up 25 seconds
novel-web        Up 25 seconds
```

---

## 五、防火墙

```bash
# 放开 SSH (必须,否则你下次连不上)
sudo ufw allow 22

# 放开 HTTP
sudo ufw allow 80

# 放开 HTTPS (即使现在没用,以后加证书会用到)
sudo ufw allow 443

# 启用
sudo ufw enable
sudo ufw status
```

注意:**不要**对外开放 5432 / 6379 / 3000 — 这些都在 docker 私有网络里,外网不需要直连。

---

## 六、验证

浏览器打开:

- **http://你的服务器IP/** → Vue 前端登录页
- **http://你的服务器IP/docs** → Swagger
- **http://你的服务器IP/healthz** → 返回 `ok`

注册一个账号 → 创建小说 → 加主题 → 创建章节 → 生成,看流程是否完整。

---

## 七、加 HTTPS(可选,有域名才需要)

最简单的方案:**用 Caddy 当外层反代**,Let's Encrypt 自动续签。

### 把域名解析到服务器(提前)

DNS 加 A 记录:`yourdomain.com` → `服务器IP`

### 装 Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### 改 docker-compose.prod.yml,让 web 不直接对外

把 `web` 服务的端口映射改成只在本机:

```yaml
  web:
    ports:
      - "127.0.0.1:8080:80"   # 不再 80,改 8080,只 localhost
```

重启:`docker compose -f docker-compose.prod.yml up -d`

### 配置 Caddy

```bash
sudo nano /etc/caddy/Caddyfile
```

```
yourdomain.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up Host {host}
        header_up X-Real-IP {remote}
    }

    # WebSocket 自动支持,Caddy 默认开
}
```

```bash
sudo systemctl reload caddy
```

打开 https://yourdomain.com,Caddy 会自动签证书。

---

## 八、日常运维

```bash
cd /opt/novel

# 看日志
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web

# 只看最近 50 行
docker compose -f docker-compose.prod.yml logs --tail=50 api

# 重启某个服务
docker compose -f docker-compose.prod.yml restart api

# 重启全部
docker compose -f docker-compose.prod.yml restart

# 升级:拉新代码 → 重新构建 → 滚动重启
git pull
docker compose -f docker-compose.prod.yml up -d --build

# 完全停掉(数据卷保留,数据不丢)
docker compose -f docker-compose.prod.yml down

# 完全清空(连数据卷都删,慎用!)
docker compose -f docker-compose.prod.yml down -v
```

---

## 九、备份

### 数据库

```bash
# 手动备份
docker exec novel-postgres pg_dump -U novel ai_novel > backup-$(date +%Y%m%d-%H%M).sql

# 加到 cron 每天凌晨 3 点备份
crontab -e
```

加这一行:
```
0 3 * * * cd /opt/novel && docker exec novel-postgres pg_dump -U novel ai_novel | gzip > /opt/novel/backups/db-$(date +\%Y\%m\%d).sql.gz
```

记得 `mkdir -p /opt/novel/backups`。

### 恢复

```bash
gunzip < backup.sql.gz | docker exec -i novel-postgres psql -U novel ai_novel
```

---

## 十、性能 / 监控参考

| 指标 | 看哪儿 |
| --- | --- |
| API 健康 | `curl http://localhost/healthz` |
| 数据库连接数 | `docker exec novel-postgres psql -U novel ai_novel -c "SELECT count(*) FROM pg_stat_activity;"` |
| Redis 内存 | `docker exec novel-redis redis-cli INFO memory \| grep used_memory_human` |
| 容器资源 | `docker stats` |
| LLM 调用日志 | `docker compose -f docker-compose.prod.yml logs api \| grep -E 'LLM (stream|fake-stream|complete)'` |

---

## 常见坑

### 1. 服务器内存爆了

LLM 调用本身不耗本地内存,主要是 PostgreSQL + Node。如果 1GB 内存吃紧:
- 给 PG 加 `command: ["postgres", "-c", "shared_buffers=128MB"]` 限制

### 2. `JWT_SECRET must be set` 启动失败

`.env` 里 JWT_SECRET 没填,docker-compose 要求 hard set。生成一个填上。

### 3. 第一次构建超时

国内网络拉 Docker Hub / npm 慢。要么:
- 等(10~20 分钟)
- 加镜像(见步骤一)
- npm 用淘宝源:在 web/Dockerfile 和 Dockerfile 的 `RUN npm ci` 前加 `RUN npm config set registry https://registry.npmmirror.com`

### 4. 前端打开 502 / 白屏

```bash
docker compose -f docker-compose.prod.yml logs web
docker compose -f docker-compose.prod.yml logs api
```

最常见:api 还在编译启动,nginx 已经接到请求转发但 api 没起来,30s 后会自愈。

### 5. WebSocket 连不上

如果你前面套了 nginx / Caddy,确保 `/socket.io/` 路径开了 WebSocket upgrade(Caddy 默认开,nginx 需要显式配)。

---

## 升级路径

未来想加:
- **多实例 + 负载均衡** → 加 Caddy/nginx 上游多个 api 容器
- **专用数据库实例** → 把 postgres 换成托管(如 RDS、阿里云 PolarDB),docker-compose 里删掉 postgres 服务,改 `DB_HOST` 为外部地址
- **CDN 加速静态资源** → 把 web/dist 上传到 CDN,nginx 只反代 API

现在这套是单机 all-in-one,够支撑几百到几千 DAU 的小说创作平台。
