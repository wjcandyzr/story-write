import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '@/api/auth';
import { setAccessToken, getAccessToken } from '@/api/client';
import type { AuthUser } from '@/types/api';

const USER_KEY = 'novel.user';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(getAccessToken());
  const user = ref<AuthUser | null>(loadCachedUser());

  const isAuthed = computed(() => !!token.value);

  async function login(username: string, password: string) {
    const res = await authApi.login({ username, password });
    apply(res.accessToken, res.user);
  }

  async function register(username: string, email: string, password: string) {
    const res = await authApi.register({ username, email, password });
    apply(res.accessToken, res.user);
  }

  async function refreshMe() {
    if (!token.value) return null;
    const me = await authApi.me();
    user.value = me;
    persistUser(me);
    return me;
  }

  function logout() {
    token.value = null;
    user.value = null;
    setAccessToken(null);
    localStorage.removeItem(USER_KEY);
  }

  function apply(t: string, u: AuthUser) {
    token.value = t;
    user.value = u;
    setAccessToken(t);
    persistUser(u);
  }

  function persistUser(u: AuthUser) {
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  }

  function loadCachedUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  return { token, user, isAuthed, login, register, logout, refreshMe };
});
