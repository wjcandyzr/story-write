<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, EditPen, MagicStick, RefreshLeft, Plus } from '@element-plus/icons-vue';
import { useNovelStore } from '@/stores/novel';
import { themeApi } from '@/api/theme';
import { chapterApi } from '@/api/chapter';
import type { Chapter, Theme } from '@/types/api';
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
  issues: streamIssues,
  errorMsg: streamError,
  generating: streamGenerating,
  start: streamStart,
  cancel: streamCancel,
} = useChapterSocket();
const currentChapter = ref<Chapter | null>(null);
const phaseLabel: Record<string, string> = {
  compress: '压缩历史',
  plan: '剧情规划',
  generate: '正文生成',
  continuity: '连续性检查',
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

const phasePills = computed(() => {
  const phases = ['compress', 'plan', 'generate', 'continuity', 'persist'] as const;
  const idx = streamPhase.value ? phases.indexOf(streamPhase.value) : -1;
  return phases.map((p, i) => ({
    name: p,
    label: phaseLabel[p],
    state: i < idx ? 'done' : i === idx ? 'active' : 'pending',
  }));
});
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
                <el-tag size="small" :type="ch.status === 'draft' ? 'success' : 'info'">{{ ch.status }}</el-tag>
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
                    {{ streamContent ? '重新生成' : '开始生成' }}
                  </el-button>
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

              <el-alert
                v-if="streamError"
                type="error" :closable="false" show-icon
                :title="streamError"
              />

              <div class="content-box">
                <div v-if="streamContent" class="streamed">{{ streamContent }}</div>
                <div v-else-if="currentChapter.content" class="streamed">{{ currentChapter.content }}</div>
                <el-empty v-else description="正文会在这里逐字出现" :image-size="64" />
              </div>

              <div v-if="streamIssues.length" class="issues">
                <h4>连续性检查 · {{ streamIssues.length }} 项</h4>
                <el-alert
                  v-for="(iss, idx) in streamIssues"
                  :key="idx"
                  :type="iss.severity === 'error' ? 'error' : iss.severity === 'warning' ? 'warning' : 'info'"
                  :title="iss.message"
                  :description="iss.suggestion"
                  show-icon :closable="false"
                  style="margin-bottom: 4px;"
                />
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
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
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
.placeholder { display: grid; place-items: center; min-height: 360px; }

.stream-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
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
.content-box {
  border: 1px solid #f0f1f3;
  border-radius: 6px;
  background: #fffdf7;
  padding: 14px 18px;
  min-height: 280px;
  max-height: 600px;
  overflow-y: auto;
}
.streamed {
  white-space: pre-wrap;
  line-height: 1.85;
  font-size: 14px;
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
</style>
