<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Delete } from '@element-plus/icons-vue';
import { useNovelStore } from '@/stores/novel';

const store = useNovelStore();
const router = useRouter();

const dialogOpen = ref(false);
const submitting = ref(false);
const form = ref({
  title: '',
  synopsis: '',
  genres: '',
  targetWordCount: 200000,
});

onMounted(() => {
  store.fetchList();
});

async function onCreate() {
  if (!form.value.title.trim()) {
    ElMessage.warning('请填写标题');
    return;
  }
  submitting.value = true;
  try {
    const genres = form.value.genres.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    const novel = await store.create({
      title: form.value.title.trim(),
      synopsis: form.value.synopsis || undefined,
      genres: genres.length ? genres : undefined,
      targetWordCount: form.value.targetWordCount,
    });
    ElMessage.success(`已创建《${novel.title}》`);
    dialogOpen.value = false;
    form.value = { title: '', synopsis: '', genres: '', targetWordCount: 200000 };
    router.push({ name: 'novel-detail', params: { id: novel.id } });
  } finally {
    submitting.value = false;
  }
}

async function onRemove(id: string, title: string) {
  await ElMessageBox.confirm(
    `删除《${title}》及其下所有主题、章节?此操作不可恢复。`,
    '危险操作',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
  );
  await store.remove(id);
  ElMessage.success('已删除');
}

const STATUS_TYPE: Record<string, 'info' | 'warning' | 'success'> = {
  draft: 'info',
  writing: 'warning',
  completed: 'success',
  archived: 'info',
};
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  writing: '连载中',
  completed: '已完结',
  archived: '归档',
};
</script>

<template>
  <div class="page">
    <div class="header-row">
      <div>
        <h2 style="margin: 0;">我的小说</h2>
        <div class="muted">共 {{ store.total }} 部</div>
      </div>
      <el-button type="primary" :icon="Plus" @click="dialogOpen = true">新建小说</el-button>
    </div>

    <el-empty v-if="!store.loading && store.list.length === 0" description="还没有小说,新建一部开始吧" />

    <div v-else class="grid">
      <el-card
        v-for="n in store.list"
        :key="n.id"
        shadow="hover"
        class="novel-card"
        @click="router.push({ name: 'novel-detail', params: { id: n.id } })"
      >
        <template #header>
          <div class="card-head">
            <div class="title" :title="n.title">{{ n.title }}</div>
            <el-tag size="small" :type="STATUS_TYPE[n.status]">{{ STATUS_LABEL[n.status] }}</el-tag>
          </div>
        </template>
        <div class="synopsis">{{ n.synopsis || '(暂无简介)' }}</div>
        <div class="meta">
          <div v-if="n.genres?.length" class="genres">
            <el-tag v-for="g in n.genres" :key="g" size="small" effect="plain" style="margin-right: 4px;">{{ g }}</el-tag>
          </div>
          <div class="muted">目标 {{ n.targetWordCount.toLocaleString() }} 字</div>
        </div>
        <div class="actions" @click.stop>
          <el-button size="small" :icon="Delete" link type="danger" @click="onRemove(n.id, n.title)">删除</el-button>
        </div>
      </el-card>
    </div>

    <el-dialog v-model="dialogOpen" title="新建小说" width="520">
      <el-form :model="form" label-width="80px">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" placeholder="例如:重生之废柴男主觉醒系统" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="form.synopsis" type="textarea" :rows="2" placeholder="一句话讲清楚卖点" />
        </el-form-item>
        <el-form-item label="类型">
          <el-input v-model="form.genres" placeholder="逗号或顿号分隔,如:玄幻、修仙、爽文" />
        </el-form-item>
        <el-form-item label="目标字数">
          <el-input-number v-model="form.targetWordCount" :min="1000" :step="10000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.header-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 20px;
  gap: 12px;
  flex-wrap: wrap;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
@media (max-width: 480px) {
  .grid { grid-template-columns: 1fr; gap: 10px; }
  .header-row { margin-bottom: 12px; }
}
.novel-card {
  cursor: pointer;
  transition: transform 0.1s;
}
.novel-card:hover { transform: translateY(-2px); }
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.title {
  font-weight: 600;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.synopsis {
  color: #4b5563;
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 60px;
}
.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}
.actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}
</style>
