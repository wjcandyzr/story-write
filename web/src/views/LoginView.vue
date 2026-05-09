<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type FormInstance } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const mode = ref<'login' | 'register'>('login');
const formRef = ref<FormInstance>();
const submitting = ref(false);

const form = ref({
  username: 'demo_user',
  email: 'demo@example.com',
  password: 'demo12345',
});

const rules = {
  username: [{ required: true, min: 3, message: '至少 3 个字符', trigger: 'blur' }],
  password: [{ required: true, min: 8, message: '至少 8 个字符', trigger: 'blur' }],
  email: [{ type: 'email' as const, message: '邮箱格式不正确', trigger: 'blur' }],
};

async function submit() {
  if (!formRef.value) return;
  await formRef.value.validate().catch(() => null).then(async (ok) => {
    if (!ok) return;
    submitting.value = true;
    try {
      if (mode.value === 'login') {
        await auth.login(form.value.username, form.value.password);
        ElMessage.success('登录成功');
      } else {
        await auth.register(form.value.username, form.value.email, form.value.password);
        ElMessage.success('注册成功,已自动登录');
      }
      const redirect = (route.query.redirect as string) || '/novels';
      router.push(redirect);
    } finally {
      submitting.value = false;
    }
  });
}
</script>

<template>
  <div class="login-wrap">
    <el-card class="login-card" shadow="never">
      <div class="title">AI Novel Platform</div>
      <div class="muted" style="margin-bottom: 18px;">长篇小说生成与剧情辅助</div>

      <el-tabs v-model="mode">
        <el-tab-pane label="登录" name="login" />
        <el-tab-pane label="注册" name="register" />
      </el-tabs>

      <el-form ref="formRef" :model="form" :rules="rules" label-width="64px" @submit.prevent="submit">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" autocomplete="username" />
        </el-form-item>
        <el-form-item v-if="mode === 'register'" label="邮箱" prop="email">
          <el-input v-model="form.email" autocomplete="email" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-button type="primary" :loading="submitting" style="width: 100%;" @click="submit">
          {{ mode === 'login' ? '登录' : '注册并登录' }}
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 16px;
  background: linear-gradient(135deg, #eef2ff 0%, #fef3c7 100%);
}
.login-card {
  width: 380px;
  max-width: 100%;
  border-radius: 12px;
}
.title {
  font-size: 20px;
  font-weight: 600;
}
@media (max-width: 480px) {
  .login-card :deep(.el-form-item__label) { width: 56px !important; }
}
</style>
