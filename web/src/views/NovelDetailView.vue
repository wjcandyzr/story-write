<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft,
  ArrowDown,
  CopyDocument,
  EditPen,
  Loading,
  MagicStick,
  RefreshLeft,
  Plus,
  Clock,
} from '@element-plus/icons-vue';
import { useNovelStore } from '@/stores/novel';
import { themeApi } from '@/api/theme';
import { chapterApi } from '@/api/chapter';
import type { Chapter, ChapterVersion, Theme } from '@/types/api';
import { useChapterSocket } from '@/composables/useChapterSocket';

const props = defineProps<{ id: string }>();
const router = useRouter();
const store = useNovelStore();

const themes = ref<Theme[]>([]);
const chapters = ref<Chapter[]>([]);
const activeTab = ref('themes');

// === theme dialog state ===
const themeDialogOpen = ref(false);
const themeSubmitting = ref(false);
const themeForm = ref({ id: '', name: '', tags: '', description: '', priority: 7 });

// === polish state ===
const polishDialogOpen = ref(false);
const polishing = ref(false);
const polishResult = ref<{ original: string; polished: string; notes?: string } | null>(null);
const polishingThemeId = ref<string | null>(null);

// === chapter dialog state ===
const chapterDialogOpen = ref(false);
const chapterSubmitting = ref(false);
const chapterDrafting = ref(false);
const chapterTitling = ref(false);
const chapterForm = ref({ title: '', outline: '', hints: '' });
const draftedThemes = ref<string[]>([]);

// === streaming state ===
// Destructure refs so the template can auto-unwrap them (nested refs are NOT
// unwrapped in templates, so `stream.phase` would expose the ref object itself).
const {
  phase: streamPhase,
  content: streamContent,
  reasoning: streamReasoning,
  issues: streamIssues,
  errorMsg: streamError,
  generating: streamGenerating,
  start: streamStart,
  cancel: streamCancel,
} = useChapterSocket();
// el-collapse 的 v-model 期望 string | string[],默认展开 'r' 这条目
const reasoningOpen = ref<string[]>(['r']);
const currentChapter = ref<Chapter | null>(null);

// === version history state ===
const versionsDialogOpen = ref(false);
const versionsLoading = ref(false);
const versions = ref<ChapterVersion[]>([]);
const phaseLabel: Record<string, string> = {
  compress: '压缩历史',
  plan: '剧情规划',
  generate: '正文生成',
  continuity: '连续性检查',
  rewrite: 'AI 修订',
  persist: '持久化',
};

onMounted(load);
watch(() => props.id, load);

async function load() {
  await store.load(props.id);
  await Promise.all([loadThemes(), loadChapters()]);
}
async function loadThemes() {
  const res = await themeApi.list(props.id);
  themes.value = res.items;
}
async function loadChapters() {
  const res = await chapterApi.list(props.id);
  chapters.value = res.items;
}

function openThemeCreate() {
  themeForm.value = { id: '', name: '', tags: '', description: '', priority: 7 };
  themeDialogOpen.value = true;
}
function openThemeEdit(t: Theme) {
  themeForm.value = {
    id: t.id,
    name: t.name,
    tags: (t.tags ?? []).join('、'),
    description: t.description ?? '',
    priority: t.priority,
  };
  themeDialogOpen.value = true;
}

async function saveTheme() {
  if (!themeForm.value.name.trim()) {
    ElMessage.warning('请填写主题名');
    return;
  }
  themeSubmitting.value = true;
  try {
    const tags = themeForm.value.tags.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    const payload = {
      name: themeForm.value.name.trim(),
      description: themeForm.value.description || undefined,
      tags,
      priority: themeForm.value.priority,
    };
    if (themeForm.value.id) {
      await themeApi.update(props.id, themeForm.value.id, payload);
      ElMessage.success('已更新');
    } else {
      await themeApi.create(props.id, payload);
      ElMessage.success('已保存');
    }
    themeDialogOpen.value = false;
    await loadThemes();
  } finally {
    themeSubmitting.value = false;
  }
}

async function removeTheme(t: Theme) {
  await ElMessageBox.confirm(`删除主题「${t.name}」?`, '确认', { type: 'warning' });
  await themeApi.remove(props.id, t.id);
  ElMessage.success('已删除');
  await loadThemes();
}

async function polishTheme(t: Theme, save: boolean) {
  if (!t.description?.trim()) {
    ElMessage.warning('该主题描述为空,无法润色');
    return;
  }
  polishing.value = true;
  polishingThemeId.value = t.id;
  try {
    const res = await themeApi.polish(props.id, t.id, { save });
    polishResult.value = { original: res.original, polished: res.polished, notes: res.notes };
    polishDialogOpen.value = true;
    if (save) {
      ElMessage.success('已润色并保存');
      await loadThemes();
    }
  } finally {
    polishing.value = false;
    polishingThemeId.value = null;
  }
}

async function revertTheme(t: Theme) {
  if (!t.previousDescription) {
    ElMessage.warning('没有可回滚的版本');
    return;
  }
  await ElMessageBox.confirm('回滚到上一版描述?', '确认', { type: 'warning' });
  await themeApi.revert(props.id, t.id);
  ElMessage.success('已回滚');
  await loadThemes();
}

// === chapter ===

async function openChapterCreate() {
  chapterForm.value = { title: '', outline: '', hints: '' };
  draftedThemes.value = [];
  chapterDialogOpen.value = true;
  // 自动起标题:基于上一章的内容/大纲推下一章应该叫什么
  // 失败也不阻塞,用户可以自己填
  await autoFillTitle({ silent: true });
}

async function autoFillTitle(opts: { silent?: boolean } = {}) {
  if (chapterTitling.value) return;
  chapterTitling.value = true;
  try {
    // 用户已经在前端填了大纲/想法时一并传过去 —— 标题就能精准切中"那一下",
    // 而不是模型自己瞎猜。第一次自动调用时大纲是空的,模型基于上一章推。
    const res = await chapterApi.draftTitle(props.id, {
      outlineHint: chapterForm.value.outline?.trim() || undefined,
      extraHints: chapterForm.value.hints?.trim() || undefined,
    });
    chapterForm.value.title = res.title;
    if (!opts.silent) ElMessage.success('已重新起标题,可继续编辑');
  } catch (e) {
    if (!opts.silent) ElMessage.error('起标题失败: ' + (e as Error).message);
  } finally {
    chapterTitling.value = false;
  }
}

async function draftOutline() {
  const title = chapterForm.value.title.trim();
  if (!title) {
    ElMessage.warning('先填写章节标题,AI 才知道你想写什么');
    return;
  }
  chapterDrafting.value = true;
  try {
    const res = await chapterApi.draftOutline(props.id, {
      title,
      hints: chapterForm.value.hints || undefined,
    });
    chapterForm.value.outline = res.outline;
    draftedThemes.value = res.themesUsed ?? [];
    ElMessage.success(
      res.themesUsed?.length
        ? `已根据主题 ${res.themesUsed.join('、')} 生成大纲,可继续编辑`
        : '已生成大纲,可继续编辑',
    );
  } finally {
    chapterDrafting.value = false;
  }
}

async function saveChapter() {
  if (!chapterForm.value.title.trim()) {
    ElMessage.warning('请填写章节标题');
    return;
  }
  chapterSubmitting.value = true;
  try {
    const ch = await chapterApi.create(props.id, {
      title: chapterForm.value.title.trim(),
      outline: chapterForm.value.outline || undefined,
    });
    ElMessage.success(`已创建第 ${ch.chapterNumber} 章`);
    chapterDialogOpen.value = false;
    await loadChapters();
  } finally {
    chapterSubmitting.value = false;
  }
}

async function removeChapter(ch: Chapter) {
  await ElMessageBox.confirm(`删除第 ${ch.chapterNumber} 章「${ch.title}」?`, '确认', { type: 'warning' });
  await chapterApi.remove(props.id, ch.id);
  ElMessage.success('已删除');
  if (currentChapter.value?.id === ch.id) currentChapter.value = null;
  await loadChapters();
}

function startGenerate(ch: Chapter) {
  currentChapter.value = ch;
  streamStart({ novelId: props.id, chapterId: ch.id });
}

async function reloadCurrent() {
  if (!currentChapter.value) return;
  currentChapter.value = await chapterApi.detail(props.id, currentChapter.value.id);
  await loadChapters();
}

// === 编辑正文对话框 ===
const editDialogOpen = ref(false);
const editContent = ref('');
const editSaving = ref(false);
const editLastSaved = ref<Date | null>(null);
const editDirty = ref(false);
let editAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function openEditChapter() {
  if (!currentChapter.value) return;
  editContent.value = streamContent.value || currentChapter.value.content || '';
  editLastSaved.value = null;
  editDirty.value = false;
  editDialogOpen.value = true;
}

function onEditInput() {
  editDirty.value = true;
  // 防抖 1.5 秒:用户停手才触发自动保存,边打字边保存太吵
  if (editAutoSaveTimer) clearTimeout(editAutoSaveTimer);
  editAutoSaveTimer = setTimeout(() => saveEdit({ silent: true }), 1500);
}

async function saveEdit(opts: { silent?: boolean } = {}) {
  if (!currentChapter.value || editSaving.value) return;
  if (!editDirty.value) {
    if (!opts.silent) ElMessage.info('内容没改动');
    return;
  }
  editSaving.value = true;
  try {
    const updated = await chapterApi.update(props.id, currentChapter.value.id, {
      content: editContent.value,
    });
    currentChapter.value = updated;
    editLastSaved.value = new Date();
    editDirty.value = false;
    await loadChapters();
    if (!opts.silent) ElMessage.success(`已保存 · ${updated.wordCount} 字`);
  } catch (e) {
    ElMessage.error('保存失败: ' + (e as Error).message);
  } finally {
    editSaving.value = false;
  }
}

async function closeEdit() {
  // 关闭时如果还有未保存改动,问一下;debounce 等不到的话立即落库
  if (editAutoSaveTimer) {
    clearTimeout(editAutoSaveTimer);
    editAutoSaveTimer = null;
  }
  if (editDirty.value) {
    try {
      await ElMessageBox.confirm('还有未保存的改动,关闭前保存吗?', '提示', {
        confirmButtonText: '保存并关闭',
        cancelButtonText: '丢弃改动',
        type: 'warning',
      });
      await saveEdit();
    } catch {
      // 用户选择丢弃
    }
  }
  editDialogOpen.value = false;
}

/**
 * 章节正文一键复制 —— 优先复制流式刚生成的最新内容,
 * 没有则回退到数据库里持久化的版本。
 */
async function copyContent() {
  const text = (streamContent.value || currentChapter.value?.content || '').trim();
  if (!text) {
    ElMessage.warning('当前没有可复制的内容');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(`已复制 ${text.length} 字到剪贴板`);
  } catch {
    // file:// 或不安全上下文下 clipboard API 可能不可用,降级到老 API
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      ElMessage.success(`已复制 ${text.length} 字`);
    } catch {
      ElMessage.error('复制失败,请手动框选');
    }
  }
}

/**
 * 切章节状态 (draft → reviewed → published 或反向)。
 * 服务器允许任意切换;UI 上做个倒退确认避免误点。
 */
async function changeChapterStatus(ch: Chapter, next: Chapter['status']) {
  if (ch.status === next) return;
  // 倒退要二次确认:published → reviewed → draft 这种回退一般是有意为之
  const order = ['planned', 'generating', 'draft', 'reviewed', 'published'];
  const isBackward = order.indexOf(next) < order.indexOf(ch.status);
  if (isBackward) {
    try {
      await ElMessageBox.confirm(
        `把第 ${ch.chapterNumber} 章从 "${CHAPTER_STATUS_LABEL[ch.status]}" 退回 "${CHAPTER_STATUS_LABEL[next]}"?`,
        '确认',
        { type: 'warning' },
      );
    } catch {
      return;
    }
  }
  const updated = await chapterApi.update(props.id, ch.id, { status: next });
  ElMessage.success(`已标为 ${CHAPTER_STATUS_LABEL[next]}`);
  // 刷新本地状态
  if (currentChapter.value?.id === ch.id) currentChapter.value = updated;
  await loadChapters();
}

/** 章节状态:数据库存的是英文枚举,UI 上一律中文。 */
const CHAPTER_STATUS_LABEL: Record<string, string> = {
  planned: '待生成',
  generating: '生成中',
  draft: '草稿',
  reviewed: '已审阅',
  published: '已发布',
};
const CHAPTER_STATUS_TYPE: Record<
  string,
  'info' | 'success' | 'warning' | 'primary' | 'danger'
> = {
  planned: 'info',
  generating: 'warning',
  draft: 'success',
  reviewed: 'primary',
  published: 'success',
};

const VERSION_REASON_LABEL: Record<string, string> = {
  initial: '首次生成',
  rewrite: '重新生成',
  continuity_fix: 'AI 修订',
  manual: '手动备份',
};
const VERSION_REASON_TYPE: Record<string, 'info' | 'warning' | 'success'> = {
  initial: 'info',
  rewrite: 'warning',
  continuity_fix: 'warning',
  manual: 'success',
};

async function openVersions() {
  if (!currentChapter.value) return;
  versionsDialogOpen.value = true;
  versionsLoading.value = true;
  try {
    versions.value = await chapterApi.listVersions(props.id, currentChapter.value.id);
  } finally {
    versionsLoading.value = false;
  }
}

async function restoreVersion(v: ChapterVersion) {
  if (!currentChapter.value) return;
  await ElMessageBox.confirm(
    `回滚到 v${v.versionNumber} (${v.wordCount} 字)?当前内容会自动备份成新版本,无损操作。`,
    '回滚版本',
    { type: 'warning', confirmButtonText: '回滚', cancelButtonText: '取消' },
  );
  const updated = await chapterApi.restoreVersion(props.id, currentChapter.value.id, v.id);
  ElMessage.success(`已回滚到 v${v.versionNumber}`);
  currentChapter.value = updated;
  versionsDialogOpen.value = false;
  await loadChapters();
}

const phasePills = computed(() => {
  // 注意:'rewrite' 不出现在常驻 pill 列表里(条件触发),
  // 所以 indexOf 时 streamPhase 可能是 'rewrite',不属于这 5 项。
  // 用 string[] 视角做 indexOf 避免 TS 拒绝。
  const phases = ['compress', 'plan', 'generate', 'continuity', 'persist'] as const;
  const idx = streamPhase.value
    ? (phases as readonly string[]).indexOf(streamPhase.value)
    : -1;
  // 当 streamPhase 是 'rewrite' 时 idx 为 -1,所有 pill 显示 pending,
  // 视觉上等价于"在 continuity 和 persist 之间停了一下",可以接受。
  return phases.map((p, i) => ({
    name: p,
    label: phaseLabel[p],
    state: i < idx ? 'done' : i === idx ? 'active' : 'pending',
  }));
});

/**
 * 整个生成过程的进度百分比。每个 phase 给一个起止区间;在 generate 阶段
 * 还会用累计的字数来做"段内推进",这样长正文流式期间进度条不会停在 25%
 * 不动到突然跳 80%,而是平滑推进。
 */
const PHASE_RANGE: Record<string, [number, number]> = {
  compress: [0, 10],
  plan: [10, 25],
  generate: [25, 80],
  continuity: [80, 86],
  rewrite: [86, 92],
  persist: [92, 99],
};
const TARGET_CHARS_FOR_GENERATE = 2500; // 用这个估算 generate 段内进度

const progressPercent = computed<number>(() => {
  if (streamError.value) return 100;
  if (!streamGenerating.value) {
    return streamContent.value ? 100 : 0;
  }
  const p = streamPhase.value;
  if (!p) return 0;
  const [start, end] = PHASE_RANGE[p] ?? [0, 0];
  if (p === 'generate') {
    const frac = Math.min(streamContent.value.length / TARGET_CHARS_FOR_GENERATE, 1);
    return Math.round(start + frac * (end - start));
  }
  // 非 generate 阶段:进入此阶段就跳到段中点,接近完成
  return Math.round((start + end) / 2);
});

const progressStatus = computed<'success' | 'exception' | undefined>(() => {
  if (streamError.value) return 'exception';
  if (!streamGenerating.value && streamContent.value) return 'success';
  return undefined;
});

/** 已解决问题计数,显示在 "连续性检查" 标题旁。 */
const resolvedIssueCount = computed(
  () => streamIssues.value.filter((i) => i.status === 'resolved').length,
);

/**
 * 渲染顺序:active error → active warning → active info → new(修订后新增)→ resolved(已解决,沉到底部)
 * 这样用户最该关注的红色 active error 永远在最上面。
 */
const ISSUE_ORDER: Record<string, number> = {
  'active-error': 0,
  'active-warning': 1,
  'active-info': 2,
  'new-error': 3,
  'new-warning': 4,
  'new-info': 5,
  'resolved-error': 9,
  'resolved-warning': 9,
  'resolved-info': 9,
};
const sortedIssues = computed(() =>
  [...streamIssues.value].sort((a, b) => {
    const ka = `${a.status ?? 'active'}-${a.severity}`;
    const kb = `${b.status ?? 'active'}-${b.severity}`;
    return (ISSUE_ORDER[ka] ?? 99) - (ISSUE_ORDER[kb] ?? 99);
  }),
);
</script>

<template>
  <div class="page" v-if="store.current">
    <div class="header-row">
      <div>
        <el-button :icon="ArrowLeft" link @click="router.push({ name: 'novels' })">返回</el-button>
        <h2 style="margin: 4px 0 4px;">{{ store.current.title }}</h2>
        <div class="muted">
          {{ store.current.synopsis || '(暂无简介)' }}
        </div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="main-tabs">
      <!-- ============ Themes ============ -->
      <el-tab-pane name="themes" label="主题 / Tags">
        <div class="tab-actions">
          <el-button type="primary" :icon="Plus" @click="openThemeCreate">新建主题</el-button>
        </div>

        <el-empty v-if="themes.length === 0" description="还没有主题" />

        <div v-else class="theme-list">
          <el-card v-for="t in themes" :key="t.id" shadow="hover" class="theme-card">
            <template #header>
              <div class="card-head">
                <strong>{{ t.name }}</strong>
                <el-tag size="small" type="info">优先级 {{ t.priority }}</el-tag>
              </div>
            </template>

            <div class="tags-row">
              <el-tag v-for="g in t.tags ?? []" :key="g" size="small" effect="plain">{{ g }}</el-tag>
              <span v-if="!t.tags?.length" class="muted">(无标签)</span>
            </div>

            <div class="desc">{{ t.description || '(无描述)' }}</div>

            <div class="actions">
              <el-button size="small" :icon="EditPen" @click="openThemeEdit(t)">编辑</el-button>
              <el-button
                size="small" type="primary" :icon="MagicStick"
                :loading="polishing && polishingThemeId === t.id"
                @click="polishTheme(t, false)"
              >预览润色</el-button>
              <el-button
                size="small" type="success" :icon="MagicStick"
                :loading="polishing && polishingThemeId === t.id"
                @click="polishTheme(t, true)"
              >润色并保存</el-button>
              <el-button v-if="t.previousDescription" size="small" :icon="RefreshLeft" @click="revertTheme(t)">回滚</el-button>
              <el-button size="small" type="danger" link @click="removeTheme(t)">删除</el-button>
            </div>
          </el-card>
        </div>
      </el-tab-pane>

      <!-- ============ Chapters ============ -->
      <el-tab-pane name="chapters" label="章节生成">
        <div class="tab-actions">
          <el-button type="primary" :icon="Plus" @click="openChapterCreate">新建章节</el-button>
        </div>

        <div class="chapter-layout">
          <div class="chapter-list-pane">
            <el-empty v-if="chapters.length === 0" description="还没有章节" />
            <el-card
              v-for="ch in chapters"
              :key="ch.id"
              shadow="hover"
              class="chapter-card"
              :class="{ active: currentChapter?.id === ch.id }"
              @click="currentChapter = ch"
            >
              <div class="ch-row">
                <span class="ch-num">第 {{ ch.chapterNumber }} 章</span>
                <span class="ch-title">{{ ch.title }}</span>
                <!-- 状态可点 → 弹下拉切换。生成中状态期间禁用避免误触。 -->
                <el-dropdown
                  trigger="click"
                  :disabled="ch.status === 'generating'"
                  @command="(s: Chapter['status']) => changeChapterStatus(ch, s)"
                  @click.stop
                >
                  <el-tag
                    size="small"
                    :type="CHAPTER_STATUS_TYPE[ch.status]"
                    style="cursor: pointer;"
                  >
                    {{ CHAPTER_STATUS_LABEL[ch.status] || ch.status }}
                    <el-icon style="margin-left: 2px; vertical-align: -1px;">
                      <ArrowDown />
                    </el-icon>
                  </el-tag>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item
                        v-for="s in (['draft', 'reviewed', 'published'] as const)"
                        :key="s"
                        :command="s"
                        :disabled="s === ch.status"
                      >
                        {{ CHAPTER_STATUS_LABEL[s] }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
              <div class="ch-meta">{{ ch.wordCount }} 字</div>
              <div class="ch-actions" @click.stop>
                <el-button
                  size="small" type="primary"
                  :disabled="streamGenerating"
                  @click="startGenerate(ch)"
                >生成</el-button>
                <el-button size="small" type="danger" link @click="removeChapter(ch)">删除</el-button>
              </div>
            </el-card>
          </div>

          <div class="chapter-stream-pane">
            <div v-if="!currentChapter" class="placeholder">
              <el-empty description="选择左侧章节,或新建一章后点 “生成”" />
            </div>
            <template v-else>
              <div class="stream-head">
                <h3 style="margin: 0;">
                  第 {{ currentChapter.chapterNumber }} 章 · {{ currentChapter.title }}
                </h3>
                <div>
                  <el-button v-if="streamGenerating" type="danger" @click="streamCancel">中断</el-button>
                  <el-button v-else type="primary" @click="startGenerate(currentChapter)">
                    {{ streamContent || currentChapter.content ? '重新生成' : '开始生成' }}
                  </el-button>
                  <el-button :icon="Clock" @click="openVersions">历史版本</el-button>
                  <el-button :icon="RefreshLeft" @click="reloadCurrent">刷新</el-button>
                </div>
              </div>

              <div v-if="currentChapter.outline" class="outline-box">
                <div class="muted" style="margin-bottom: 4px;">大纲</div>
                <div>{{ currentChapter.outline }}</div>
              </div>

              <div class="phase-row">
                <el-tag
                  v-for="p in phasePills"
                  :key="p.name"
                  :type="p.state === 'done' ? 'success' : p.state === 'active' ? 'warning' : 'info'"
                  effect="plain"
                  size="small"
                  style="margin-right: 6px;"
                >
                  {{ p.label }}
                </el-tag>
              </div>

              <!-- 总进度条:仅在生成中或有进展时显示 -->
              <div
                v-if="streamGenerating || streamContent || streamError"
                class="progress-row"
              >
                <el-progress
                  :percentage="progressPercent"
                  :status="progressStatus"
                  :stroke-width="6"
                />
                <div class="progress-label">
                  {{ streamGenerating ? phaseLabel[streamPhase ?? 'compress'] || '准备中…' : (streamError ? '已中止' : '已完成') }}
                </div>
              </div>

              <!-- 思考链折叠面板:仅在出现 reasoning 时才出现 -->
              <el-collapse v-if="streamReasoning" v-model="reasoningOpen" class="reasoning-panel">
                <el-collapse-item name="r">
                  <template #title>
                    <span class="reasoning-title">
                      🤔 模型思考过程 · {{ streamReasoning.length }} 字
                    </span>
                  </template>
                  <div class="reasoning-body">{{ streamReasoning }}</div>
                </el-collapse-item>
              </el-collapse>

              <el-alert
                v-if="streamError"
                type="error" :closable="false" show-icon
                :title="streamError"
              />

              <!-- 正文区域顶部工具条:左边字数,右边编辑 + 一键复制 -->
              <div class="content-toolbar" v-if="streamContent || currentChapter.content || streamGenerating">
                <span class="muted">
                  正文 · {{ (streamContent || currentChapter.content || '').length }} 字
                </span>
                <div class="content-toolbar-actions">
                  <el-button
                    size="small"
                    :icon="EditPen"
                    :disabled="streamGenerating || (!streamContent && !currentChapter.content)"
                    @click="openEditChapter"
                  >编辑</el-button>
                  <el-button
                    size="small"
                    :icon="CopyDocument"
                    type="primary"
                    plain
                    :disabled="!streamContent && !currentChapter.content"
                    @click="copyContent"
                  >一键复制</el-button>
                </div>
              </div>

              <div class="content-box">
                <!-- 生成中:旧内容立刻清空,显示占位提示;有 token 来后渐显正文 -->
                <template v-if="streamGenerating">
                  <div v-if="streamContent" class="streamed">{{ streamContent }}</div>
                  <div v-else class="generating-placeholder">
                    <el-icon class="spin"><Loading /></el-icon>
                    <span>{{ phaseLabel[streamPhase ?? 'compress'] || '正在准备…' }} · 文字稍后逐段冒出</span>
                  </div>
                </template>
                <!-- 不在生成中:刚生成完保留 streamContent,否则回退到数据库存的版本 -->
                <template v-else>
                  <div v-if="streamContent" class="streamed">{{ streamContent }}</div>
                  <div v-else-if="currentChapter.content" class="streamed">{{ currentChapter.content }}</div>
                  <el-empty v-else description="正文会在这里逐字出现" :image-size="64" />
                </template>
              </div>

              <div v-if="streamIssues.length" class="issues">
                <h4>
                  连续性检查 · 共 {{ streamIssues.length }} 项
                  <span v-if="resolvedIssueCount" class="resolved-count">
                    · ✅ {{ resolvedIssueCount }} 项已解决
                  </span>
                </h4>
                <div
                  v-for="(iss, idx) in sortedIssues"
                  :key="iss.id ?? idx"
                  class="issue-row"
                  :class="`issue-${iss.status ?? 'active'}`"
                >
                  <span class="issue-tag">
                    <template v-if="iss.status === 'resolved'">
                      <el-tag type="success" size="small" effect="dark">已解决</el-tag>
                    </template>
                    <template v-else-if="iss.status === 'new'">
                      <el-tag type="warning" size="small" effect="dark">修订后新增</el-tag>
                    </template>
                    <template v-else>
                      <el-tag
                        :type="iss.severity === 'error' ? 'danger' : iss.severity === 'warning' ? 'warning' : 'info'"
                        size="small"
                      >{{ iss.severity }}</el-tag>
                    </template>
                  </span>
                  <span class="issue-msg">{{ iss.message }}</span>
                  <div v-if="iss.suggestion" class="issue-suggestion">
                    建议:{{ iss.suggestion }}
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- Theme dialog -->
    <el-dialog v-model="themeDialogOpen" :title="themeForm.id ? '编辑主题' : '新建主题'" width="560">
      <el-form :model="themeForm" label-width="80px">
        <el-form-item label="主题名" required>
          <el-input v-model="themeForm.name" placeholder="例如:末世废土" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="themeForm.tags" placeholder="逗号或顿号分隔,如:丧尸、末日生存" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="themeForm.description" type="textarea" :rows="5" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="themeForm.priority" :min="1" :max="10" />
          <span class="muted" style="margin-left: 8px;">越高越会注入到章节生成上下文</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="themeDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="themeSubmitting" @click="saveTheme">保存</el-button>
      </template>
    </el-dialog>

    <!-- Polish result dialog -->
    <el-dialog v-model="polishDialogOpen" title="AI 润色结果" width="720">
      <div v-if="polishResult">
        <div class="muted" style="margin-bottom: 4px;">原文</div>
        <div class="diff-box original">{{ polishResult.original }}</div>
        <div class="muted" style="margin: 12px 0 4px;">润色后</div>
        <div class="diff-box polished">{{ polishResult.polished }}</div>
        <div v-if="polishResult.notes" class="notes">
          <strong>编辑笔记: </strong>{{ polishResult.notes }}
        </div>
      </div>
    </el-dialog>

    <!-- Edit content dialog -->
    <el-dialog
      v-model="editDialogOpen"
      :title="`编辑第 ${currentChapter?.chapterNumber ?? ''} 章正文`"
      width="800"
      top="5vh"
      :close-on-click-modal="false"
      :before-close="closeEdit"
      class="edit-dialog"
    >
      <div class="edit-toolbar-row">
        <span class="muted">
          {{ editContent.length }} 字
          <span v-if="editDirty" class="edit-dirty">· 有未保存改动</span>
          <span v-else-if="editLastSaved" class="edit-saved">
            · 已保存 {{ editLastSaved.toLocaleTimeString() }}
          </span>
          <span v-else class="muted">· 修改后 1.5 秒会自动保存</span>
        </span>
        <span class="muted">Ctrl + S 立即保存 · ESC 退出</span>
      </div>
      <el-input
        v-model="editContent"
        type="textarea"
        :autosize="{ minRows: 18, maxRows: 28 }"
        placeholder="在这里改正文。改完会自动保存,旧版进入历史版本。"
        @input="onEditInput"
        @keydown.ctrl.s.prevent="saveEdit()"
        @keydown.meta.s.prevent="saveEdit()"
      />
      <template #footer>
        <el-button @click="closeEdit">关闭</el-button>
        <el-button
          type="primary"
          :loading="editSaving"
          :disabled="!editDirty"
          @click="saveEdit()"
        >保存</el-button>
      </template>
    </el-dialog>

    <!-- Version history dialog -->
    <el-dialog v-model="versionsDialogOpen" title="历史版本" width="780">
      <el-empty v-if="!versionsLoading && versions.length === 0" description="还没有保存过版本" />
      <el-skeleton v-if="versionsLoading" :rows="4" animated />

      <div v-else class="version-list">
        <el-card v-for="v in versions" :key="v.id" class="version-card" shadow="hover">
          <div class="version-head">
            <div>
              <span class="ver-num">v{{ v.versionNumber }}</span>
              <el-tag size="small" :type="VERSION_REASON_TYPE[v.reason]" effect="plain"
                style="margin-left: 6px;">
                {{ VERSION_REASON_LABEL[v.reason] || v.reason }}
              </el-tag>
              <span class="muted" style="margin-left: 8px;">
                {{ new Date(v.createdAt).toLocaleString() }} · {{ v.wordCount }} 字
              </span>
            </div>
            <el-button size="small" type="primary" @click="restoreVersion(v)">回滚到此版本</el-button>
          </div>
          <div v-if="v.note" class="version-note">{{ v.note }}</div>
          <div class="version-preview">{{ v.content.slice(0, 240) }}{{ v.content.length > 240 ? '…' : '' }}</div>
          <div v-if="v.continuityIssues?.length" class="muted" style="margin-top: 6px;">
            连续性: {{ v.continuityIssues.length }} 项
            ({{ v.continuityIssues.filter(i => i.severity === 'error').length }} 个 error)
          </div>
        </el-card>
      </div>
    </el-dialog>

    <!-- Chapter dialog -->
    <el-dialog v-model="chapterDialogOpen" title="新建章节" width="640">
      <el-form :model="chapterForm" label-width="80px">
        <el-form-item label="标题" required>
          <el-input
            v-model="chapterForm.title"
            placeholder="打开时会自动起,也可以手动改"
            :loading="chapterTitling"
            :disabled="chapterTitling"
          >
            <template #append>
              <el-button
                :icon="MagicStick"
                :loading="chapterTitling"
                @click="autoFillTitle()"
              >AI 重起</el-button>
            </template>
          </el-input>
          <div v-if="chapterTitling" class="muted" style="margin-top: 4px;">
            正在根据上一章生成标题…
          </div>
        </el-form-item>

        <el-form-item label="附加想法">
          <el-input
            v-model="chapterForm.hints" type="textarea" :rows="2"
            placeholder="(可选) 你希望本章往哪个方向走、要不要某个角色登场。会影响 AI 生成的大纲。"
          />
        </el-form-item>

        <el-form-item label="大纲">
          <div style="width: 100%;">
            <div class="draft-row">
              <el-button
                type="primary" plain :icon="MagicStick"
                :loading="chapterDrafting"
                :disabled="!chapterForm.title.trim()"
                @click="draftOutline"
              >
                {{ chapterForm.outline ? '重新让 AI 生成大纲' : 'AI 生成大纲' }}
              </el-button>
              <span class="muted" style="margin-left: 8px;">
                AI 会基于本书的主题、世界观、角色和前情写一段建议大纲,你可以在下面继续编辑。
              </span>
            </div>

            <div v-if="draftedThemes.length" class="draft-themes">
              已用主题:
              <el-tag
                v-for="t in draftedThemes" :key="t"
                size="small" effect="plain" style="margin-right: 4px;"
              >{{ t }}</el-tag>
            </div>

            <el-input
              v-model="chapterForm.outline" type="textarea" :rows="7"
              placeholder="本章发生什么、关键转折、章末钩子。越具体生成越准。点击上方按钮让 AI 帮你起一稿。"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="chapterDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="chapterSubmitting" @click="saveChapter">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.header-row { margin-bottom: 16px; }

.main-tabs :deep(.el-tabs__content) { padding-top: 12px; }

.tab-actions { margin-bottom: 12px; }

.theme-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
@media (max-width: 768px) {
  .theme-list { grid-template-columns: 1fr; }
}
.theme-card .card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tags-row { margin-bottom: 8px; display: flex; gap: 4px; flex-wrap: wrap; }
.desc {
  color: #4b5563;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 8px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border-top: 1px solid #f0f1f3;
  padding-top: 8px;
}

.chapter-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
  align-items: flex-start;
}
@media (max-width: 1024px) {
  /* 平板竖屏 / 手机:章节列表横向滚动 + 生成区在下,正文有完整宽度
     左右双列只在 ≥1025px 上才出现(iPad Pro 12.9 横屏、桌面) */
  .chapter-layout { grid-template-columns: 1fr; }
  .chapter-list-pane {
    flex-direction: row !important;
    overflow-x: auto;
    padding-bottom: 6px;
  }
  .chapter-list-pane .chapter-card {
    flex: 0 0 220px;
  }
}
@media (max-width: 480px) {
  .chapter-list-pane .chapter-card { flex: 0 0 180px; }
}
.chapter-list-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chapter-card {
  cursor: pointer;
  transition: border 0.1s;
}
.chapter-card.active { border: 2px solid #2563eb; }
.ch-row { display: flex; align-items: center; gap: 8px; }
.ch-num { font-weight: 600; color: #2563eb; min-width: 64px; }
.ch-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-meta { font-size: 12px; color: #9ca3af; margin-top: 4px; }
.ch-actions { margin-top: 8px; display: flex; gap: 6px; }

.chapter-stream-pane {
  background: #fff;
  border: 1px solid #e3e7ec;
  border-radius: 10px;
  padding: 16px 20px;
  min-height: 400px;
}
@media (max-width: 600px) {
  .chapter-stream-pane { padding: 12px; min-height: 320px; }
  .content-box { min-height: 220px !important; max-height: 60vh; padding: 10px 12px; }
}
.placeholder { display: grid; place-items: center; min-height: 360px; }

.stream-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
  flex-wrap: wrap;
}
@media (max-width: 600px) {
  .stream-head h3 { font-size: 15px; flex: 1 1 100%; }
}
.outline-box {
  background: #f9fafb;
  border-left: 3px solid #2563eb;
  padding: 8px 12px;
  font-size: 13px;
  border-radius: 4px;
  margin-bottom: 12px;
}
.phase-row { margin-bottom: 12px; }
.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.progress-row :deep(.el-progress) { flex: 1; }
.progress-label {
  font-size: 12px;
  color: #6b7280;
  min-width: 64px;
  text-align: right;
}
@media (max-width: 480px) {
  .progress-row { gap: 8px; }
  .progress-label { min-width: 48px; font-size: 11px; }
}
.reasoning-panel {
  margin-bottom: 12px;
  background: #f8f7f2;
  border-radius: 8px;
  padding: 0 14px;
  border: 1px solid #e7e3d7;
}
.reasoning-panel :deep(.el-collapse-item__header) {
  background: transparent;
  border-bottom: none;
  font-weight: 500;
}
.reasoning-title {
  color: #92400e;
  font-size: 13px;
}
.reasoning-body {
  font-size: 13px;
  line-height: 1.7;
  color: #4b5563;
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
  padding: 6px 0 12px;
}

/* === continuity issues === */
.issues h4 { margin: 0 0 8px; font-size: 14px; }
.issues .resolved-count { color: #16a34a; font-size: 12px; font-weight: 500; }
.issue-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 8px 10px;
  padding: 8px 12px;
  margin-bottom: 4px;
  border-radius: 6px;
  border: 1px solid #f0f1f3;
  background: #fff;
  font-size: 13px;
  line-height: 1.65;
}
@media (max-width: 600px) {
  /* tag 一行,消息一行,而不是左右两列 */
  .issue-row { grid-template-columns: 1fr; gap: 4px; padding: 8px 10px; }
  .issue-row .issue-suggestion { grid-column: 1; padding-left: 0; border-left: none; border-top: 1px dashed #e5e7eb; padding-top: 4px; }
}
.issue-tag { align-self: start; }
.issue-msg { color: #1f2933; }
.issue-suggestion {
  grid-column: 2;
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
  border-left: 2px solid #e5e7eb;
  padding-left: 8px;
}
.issue-row.issue-resolved {
  background: #f0fdf4;
  border-color: #bbf7d0;
}
.issue-row.issue-resolved .issue-msg {
  color: #166534;
  text-decoration: line-through;
  text-decoration-color: #86efac;
}
.issue-row.issue-new {
  background: #fffbeb;
  border-color: #fde68a;
}
.content-box {
  border: 1px solid #f0f1f3;
  border-radius: 6px;
  background: #fffdf7;
  padding: 14px 18px;
  min-height: 280px;
  max-height: 600px;
  overflow-y: auto;
}
.content-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  padding: 0 4px;
}
.content-toolbar-actions {
  display: flex;
  gap: 6px;
}
.edit-dialog :deep(.el-textarea__inner) {
  font-family: ui-monospace, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.85;
}
.edit-toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
}
.edit-dirty { color: #d97706; font-weight: 500; }
.edit-saved { color: #16a34a; }
.streamed {
  white-space: pre-wrap;
  line-height: 1.85;
  font-size: 14px;
}
.generating-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  min-height: 220px;
  color: #6b7280;
  font-size: 14px;
}
.generating-placeholder .spin {
  font-size: 22px;
  animation: rotating 1.2s linear infinite;
}
@keyframes rotating {
  from { transform: rotate(0); }
  to   { transform: rotate(360deg); }
}
.issues { margin-top: 16px; }

.diff-box {
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}
.diff-box.original { background: #fef2f2; }
.diff-box.polished { background: #ecfdf5; }
.notes {
  margin-top: 12px;
  font-size: 13px;
  color: #4b5563;
}
.draft-row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.draft-themes {
  margin-bottom: 6px;
  font-size: 12px;
  color: #6b7280;
}
.version-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow-y: auto;
}
.version-card .version-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.ver-num {
  font-weight: 600;
  color: #2563eb;
}
.version-note {
  font-size: 12px;
  color: #6b7280;
  font-style: italic;
  margin-bottom: 6px;
}
.version-preview {
  font-size: 13px;
  line-height: 1.65;
  color: #374151;
  background: #f9fafb;
  padding: 8px 10px;
  border-radius: 6px;
  white-space: pre-wrap;
}
</style>
