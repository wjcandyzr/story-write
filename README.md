# AI Novel Platform

NestJS + LangGraph + PostgreSQL + Redis 长篇小说生成平台。

## 仓库结构

```
.
├── src/                              # NestJS 后端
├── demo/                             # 旧的单文件 HTML demo(可保留作冒烟测试)
└── web/                              # Vue 3 + TS + Element Plus 前端
```

## 后端架构

```
src/
├── main.ts / app.module.ts
├── common/                       # guards / filters / interceptors / decorators
├── infrastructure/               # 横切设施
│   ├── database/                 # TypeORM data-source / config / seeds
│   ├── redis/                    # ioredis 全局 client
│   ├── llm/                      # ChatOpenAI 包装 (兼容 deepseek / 自托管)
│   └── checkpoint/               # LangGraph PostgresSaver
└── modules/                      # DDD 业务模块
    ├── auth /  user              # JWT + RBAC
    ├── novel                     # 小说项目
    ├── world-bible               # 世界圣经 CRUD
    ├── character                 # 人物档案 CRUD
    ├── prompt-template           # Prompt 模板版本化
    ├── chapter                   # 章节 CRUD + WebSocket streaming
    └── agents                    # LangGraph 多 Agent
        ├── plot-planner
        ├── context-compressor
        ├── content-generator
        ├── continuity-checker
        └── orchestrator          # StateGraph: compress → plan → generate → continuity → persist
```

每个模块按 DDD 切分:`domain` (实体/值对象/枚举) · `application` (use-case service) · `infrastructure` (TypeORM entity / repository) · `interfaces` (controller / dto / gateway)。

## 快速开始

### 后端

```bash
cp .env.example .env
# 填入 OPENAI_API_KEY 等
docker compose up -d postgres redis     # 起 PG / Redis
npm install
npm run start:dev                        # 起 nest @ :3000
```

### 前端

```bash
cd web
npm install
npm run dev                              # vite @ :4000,带 /api 与 /ws 代理
```

打开 **http://localhost:4000/** 进入 Vue 应用。

服务清单:

| 入口 | 地址 |
| --- | --- |
| Vue 前端 (开发) | http://localhost:4000/ |
| REST API | http://localhost:3000/api |
| Swagger 文档 | http://localhost:3000/docs |
| WebSocket | ws://localhost:3000/ws |
| 旧版 demo HTML | http://localhost:3000/(由 nest 静态托管) |

> 首次部署时 `docker-compose.yml` 默认 `DB_SYNC=true`,生产环境请改为 `false` 并使用 `npm run migration:run`。

## 主要 REST 路径 (均需 `Authorization: Bearer <jwt>`,除 register/login)

```
POST  /api/auth/register
POST  /api/auth/login
GET   /api/auth/me

GET   /api/novels
POST  /api/novels
GET   /api/novels/:id
PATCH /api/novels/:id
DELETE /api/novels/:id

# 嵌套资源
.../novels/:novelId/world-bible       (CRUD)
.../novels/:novelId/characters        (CRUD)
.../novels/:novelId/chapters          (CRUD)
.../novels/:novelId/chapters/:id/generate    POST 触发非流式生成

GET/POST/PATCH/DELETE /api/prompt-templates
```

## WebSocket Streaming

```js
const sock = io('http://localhost:3000/ws', { auth: { token } });

sock.emit('chapter:generate', { novelId, chapterId, extraInstructions });

sock.on('chapter:phase',      (e) => console.log('phase', e.phase));
sock.on('chapter:token',      (e) => process.stdout.write(e.value));
sock.on('chapter:continuity', (e) => console.log('issues', e.issues));
sock.on('chapter:done',       (e) => console.log('finished', e.content.length));
sock.on('chapter:error',      (e) => console.error(e));

sock.emit('chapter:cancel');   // 中断
```

## LangGraph Checkpoint

`@langchain/langgraph-checkpoint-postgres` 在 `CHECKPOINT_PG_URL` 库内自动建表。每次 `runChapter` 都带 `thread_id`(默认 uuid),传同一个 id 即可恢复中断的运行。

```ts
orchestrator.runChapter({ novelId, chapterId, ownerId, threadId: existingThreadId });
```

## 测试

```bash
npm install
npm test                 # jest 单测
npm run test:cov         # 覆盖率
```

已包含的关键单测:
- `PromptTemplateService.render` 占位符替换
- `NovelService` / `ChapterService` CRUD + 越权
- `RolesGuard` RBAC 矩阵
- `PlotPlannerAgent` / `ContinuityCheckerAgent` JSON 解析容错

## RBAC

`UserRole.ADMIN | AUTHOR | READER`,在控制器顶部用 `@Roles(...)` 声明。`@Public()` 用来跳过 JWT(注册/登录)。

## 注意事项

- 项目交付的是 **可编译运行的脚手架**,真正跑起来需 `npm install` 并补充 `LANGGRAPH_CHECKPOINTER` 所需的 PG 权限。
- `LlmService` 默认走 OpenAI 协议,可通过 `OPENAI_BASE_URL` 指向 deepseek / vLLM / Ollama-OpenAI-shim 等任意兼容服务。
- 上下文压缩缓存使用 Redis,key 含章节 `updatedAt` hash,改章会自动失效。
