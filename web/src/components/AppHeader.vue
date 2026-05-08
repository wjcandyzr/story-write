<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowDown } from '@element-plus/icons-vue';

const auth = useAuthStore();
const router = useRouter();

function onCommand(cmd: string | number | object) {
  if (cmd === 'logout') {
    auth.logout();
    ElMessage.success('已退出登录');
    router.push({ name: 'login' });
  }
}
</script>

<template>
  <header class="app-header">
    <div class="brand" @click="router.push({ name: 'novels' })">
      <span class="dot" />
      AI Novel Platform
    </div>
    <div class="spacer" />
    <a href="/docs" target="_blank" class="link">Swagger</a>
    <el-dropdown v-if="auth.user" @command="onCommand">
      <span class="user">
        {{ auth.user.username }}
        <el-icon><ArrowDown /></el-icon>
      </span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item disabled>角色: {{ auth.user.roles.join(', ') }}</el-dropdown-item>
          <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}
.brand {
  font-weight: 600;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, #2563eb, #7c3aed);
}
.spacer { flex: 1; }
.link { color: #2563eb; font-size: 13px; }
.user {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
}
</style>
