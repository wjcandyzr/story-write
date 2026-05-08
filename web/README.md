# AI Novel · Web

Vue 3 + TypeScript + Element Plus + Pinia + Vue Router + Axios 前端。

## 目录

```
web/
├── index.html
├── vite.config.ts                     # /api + /ws 代理到 nest @ :3000
├── tsconfig.json
└── src/
    ├── main.ts                        # 入口:Pinia + Router + Element Plus
    ├── App.vue                        # 根组件,根据 route.meta.layout 切换
    ├── router/                        # vue-router + auth guard
    ├── stores/                        # Pinia stores (auth, novel)
    ├── api/                           # axios 模块化封装
    │   ├── client.ts                  # JWT 注入 + 401 重定向 + envelope 解包
    │   ├── auth.ts / novel.ts / theme.ts / chapter.ts
    ├── composables/
    │   └── useChapterSocket.ts        # WebSocket 流式生成
    ├── views/                         # 路由级页面
    │   ├── LoginView.vue
    │   ├── NovelListView.vue
    │   ├── NovelDetailView.vue        # 主题/润色/章节生成 三合一
    │   └── NotFoundView.vue
    ├── components/AppHeader.vue
    ├── types/api.ts                   # 后端 DTO 镜像类型
    └── styles/main.css
```

## 跑

```bash
npm install
npm run dev
```

确保后端在 :3000(`npm run start:dev` 或 docker compose)。

## 功能对应

| 页面 | 后端能力 |
| --- | --- |
| `/login` | `POST /api/auth/{login,register}` |
| `/novels` | 小说列表 + 新建 + 删除 |
| `/novels/:id` (主题 tab) | 主题 CRUD + AI 润色 + 回滚 |
| `/novels/:id` (章节 tab) | 章节 CRUD + WebSocket 流式生成 + 连续性检查 |

## 构建

```bash
npm run build
# 产物在 web/dist/,可部署到任何静态服务器或 nginx
```

如要让 nest 同时托管前端,把 `dist/` 拷到 nest 的静态目录(目前默认是 `demo/`),
或在 `main.ts` 多挂一段 `useStaticAssets(join(process.cwd(), 'web/dist'))`。
