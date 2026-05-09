<script setup lang="ts">
import { onMounted, ref } from 'vue';

const container = ref<HTMLDivElement | null>(null);
const errorMsg = ref<string | null>(null);

/**
 * Mermaid 流程图源码 — 真实反映 ChapterOrchestrator.streamChapter() 的流程。
 * 每次 orchestrator 改了步骤,这里要同步改一下,否则就是骗用户。
 */
const diagram = `
flowchart TD
  User([用户点击 开始生成]) --> Load[loadContext<br/>加载小说 / 章节 / 世界观 / 角色 / 前几章]
  Load --> Phase1[阶段 1 · 压缩历史<br/>ContextCompressorAgent]
  Phase1 -. Redis 缓存命中直接返回 .-> Phase1
  Phase1 --> Phase2[阶段 2 · 剧情规划<br/>PlotPlannerAgent.plan<br/>产出 beats / hook / cliffhanger]
  Phase2 --> Phase3[阶段 3 · 正文生成<br/>ContentGeneratorAgent.streamChapter]
  Phase3 -. WebSocket 流式<br/>content + reasoning .-> Frontend((前端 UI))
  Phase3 --> Phase4[阶段 4 · 连续性检查<br/>ContinuityCheckerAgent.check<br/>每个 issue 打 id+active+时间戳]
  Phase4 --> Snap1[(快照 v1<br/>reason=initial)]
  Snap1 --> Decide{有 error 或 warning?}
  Decide -- 无 --> Phase5
  Decide -- 有 --> Phase45[阶段 4.5 · AI 修订<br/>rewriteWithFixes<br/>非流式 · 最小化修改]
  Phase45 --> Phase4b[再做一轮连续性检查]
  Phase4b --> Diff[diff issues<br/>resolved / active / new]
  Diff --> Replace[chapter:replace 事件<br/>前端整段替换正文]
  Replace --> Snap2[(快照 v2<br/>reason=continuity_fix)]
  Snap2 --> Phase5[阶段 5 · 持久化<br/>chapters.patchInternal<br/>写入 content / status=draft / issues]
  Phase5 --> Done([章节就绪 · 前端进度条 100%])

  classDef phase fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e
  classDef check fill:#fce7f3,stroke:#db2777,color:#9d174d
  classDef snap fill:#f3e8ff,stroke:#9333ea,color:#6b21a8
  classDef rewrite fill:#fed7aa,stroke:#ea580c,color:#9a3412
  classDef persist fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef terminal fill:#e0e7ff,stroke:#4f46e5,color:#3730a3

  class Phase1,Phase2,Phase3 phase
  class Phase4,Phase4b check
  class Phase45 rewrite
  class Phase5 persist
  class Snap1,Snap2 snap
  class User,Done terminal
`;

const agents = [
  {
    name: 'ContextCompressorAgent',
    role: '压缩历史',
    detail:
      '把前面 N 章正文压缩成精炼摘要,保留关键人物/物品/伏笔。Redis 缓存按章节 updatedAt hash,改章自动失效。',
    color: '#0284c7',
  },
  {
    name: 'PlotPlannerAgent',
    role: '剧情规划 / 起标题 / 起大纲',
    detail:
      '本章节奏与冲突。三个独立方法:plan() 给生成器打 beats; draftOutline() 用户填标题后建议大纲; draftTitle() 根据上一章自动起标题。',
    color: '#16a34a',
  },
  {
    name: 'ContentGeneratorAgent',
    role: '正文生成 / 修订',
    detail:
      'streamChapter() 流式产出正文,LlmService 区分 content/reasoning chunks。rewriteWithFixes() 拿连续性问题做最小化修订。',
    color: '#d97706',
  },
  {
    name: 'ContinuityCheckerAgent',
    role: '连续性检查',
    detail:
      '对比章节正文与世界圣经/角色档案/前情,产出 error / warning / info 三级 issue。orchestrator 在重写前后各调一次,做 diff。',
    color: '#db2777',
  },
  {
    name: 'PolishAgent',
    role: '通用润色(独立路径)',
    detail:
      '主题/世界观/角色背景的 polish。不在章节生成主流程里,由 ThemeController 等单独触发。',
    color: '#9333ea',
  },
];

const phaseLines = [
  { p: '阶段 1', n: 'compress', detail: '检查 Redis,没缓存就让 LLM 压缩前情' },
  { p: '阶段 2', n: 'plan', detail: '产出结构化 beats + 钩子 + 章末悬念' },
  { p: '阶段 3', n: 'generate', detail: 'WebSocket 推 token 给前端;支持中断' },
  { p: '阶段 4', n: 'continuity', detail: '一轮检查,issue 落到 chapter + 快照' },
  { p: '阶段 4.5', n: 'rewrite', detail: '仅当 error/warning > 0 才进入,最多 1 次' },
  { p: '阶段 5', n: 'persist', detail: '写回 chapters 表,生效到读者看到的内容' },
];

onMounted(async () => {
  try {
    const mod = await import('mermaid');
    const mermaid = mod.default;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        fontFamily: '-apple-system, "Microsoft YaHei", sans-serif',
        fontSize: '13px',
      },
      flowchart: {
        curve: 'basis',
        padding: 12,
      },
    });
    const { svg } = await mermaid.render('workflow-graph', diagram);
    if (container.value) container.value.innerHTML = svg;
  } catch (e) {
    errorMsg.value = (e as Error).message;
  }
});
</script>

<template>
  <div class="page workflow-page">
    <h2 style="margin-top: 0;">LangGraph 章节生成工作流</h2>
    <p class="muted" style="margin-bottom: 16px;">
      下图反映 <code>ChapterOrchestrator.streamChapter()</code> 的真实执行顺序。
      流式生成走 <strong>1 → 2 → 3 → 4</strong>,如果第 4 步发现矛盾会自动进入 <strong>4.5 AI 修订</strong>,然后才落到 5 持久化。
    </p>

    <el-card shadow="never" class="diagram-card">
      <div ref="container" class="diagram-wrap"></div>
      <el-alert v-if="errorMsg" type="error" show-icon :title="errorMsg" />
    </el-card>

    <div class="grid">
      <el-card shadow="never">
        <template #header>
          <strong>5 个阶段(WebSocket 事件 chapter:phase)</strong>
        </template>
        <div v-for="row in phaseLines" :key="row.n" class="phase-line">
          <span class="phase-num">{{ row.p }}</span>
          <code>{{ row.n }}</code>
          <span class="muted">{{ row.detail }}</span>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <strong>5 个 Agent</strong>
        </template>
        <div v-for="a in agents" :key="a.name" class="agent-line">
          <div class="agent-head">
            <span class="agent-dot" :style="{ background: a.color }"></span>
            <strong>{{ a.name }}</strong>
            <span class="muted">· {{ a.role }}</span>
          </div>
          <div class="agent-detail muted">{{ a.detail }}</div>
        </div>
      </el-card>
    </div>

    <el-card shadow="never" class="extra-card">
      <template #header>
        <strong>不在主流程里的两条独立通道</strong>
      </template>
      <ul class="extra-list">
        <li>
          <strong>主题润色</strong>:<code>POST /novels/:id/themes/:tid/polish</code> →
          PolishAgent 直接润色 description,旧版进 <code>previousDescription</code>,可一键 revert。
        </li>
        <li>
          <strong>章节大纲 / 标题草稿</strong>:<code>POST /chapters/draft-outline</code> /
          <code>draft-title</code>,只调 LLM 一次返回文字,不写库,不动 LangGraph,1~2 秒响应。
        </li>
        <li>
          <strong>历史版本回滚</strong>:<code>POST /chapters/:id/versions/:vid/restore</code>,
          先把当前内容快照成 manual 版,再覆盖 — 永远无损。
        </li>
        <li>
          <strong>编辑模式</strong>:<code>PATCH /chapters/:id</code> body 带 content 时,
          <code>ChapterService.update</code> 会自动先快照(reason=manual)再覆盖,跟 AI 生成走相同的版本流。
        </li>
      </ul>
    </el-card>
  </div>
</template>

<style scoped>
.workflow-page { max-width: 1100px; }

.diagram-card {
  margin-bottom: 20px;
  background: #fafbfc;
}
.diagram-wrap {
  display: flex;
  justify-content: center;
  overflow-x: auto;
  padding: 16px 0;
}
.diagram-wrap :deep(svg) {
  max-width: 100%;
  height: auto;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
}

.phase-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed #f0f1f3;
  font-size: 13px;
}
.phase-line:last-child { border-bottom: none; }
.phase-num {
  font-weight: 600;
  color: #d97706;
  min-width: 56px;
}
.phase-line code {
  background: #fef3c7;
  color: #92400e;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.agent-line {
  padding: 8px 0;
  border-bottom: 1px dashed #f0f1f3;
}
.agent-line:last-child { border-bottom: none; }
.agent-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.agent-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.agent-detail {
  font-size: 12px;
  margin-top: 4px;
  margin-left: 18px;
  line-height: 1.65;
}

.extra-card .extra-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.85;
}
.extra-card code {
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
  color: #374151;
}
</style>
