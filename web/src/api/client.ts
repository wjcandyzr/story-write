import axios, { AxiosError, type AxiosInstance } from 'axios';
import { ElMessage } from 'element-plus';
import type { ApiEnvelope } from '@/types/api';

/**
 * Axios singleton with:
 *  - baseURL `/api` (Vite proxies to :3000 in dev, same-origin in prod)
 *  - JWT bearer injected from localStorage
 *  - response unwrapping: `{ success, data }` → just `data`
 *  - 401 → clear token + force back to /login
 */
export const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 60_000,
});

const TOKEN_KEY = 'novel.token';

export function setAccessToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

http.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (res) => {
    // Unwrap envelope so callers see plain `data`.
    const env = res.data as ApiEnvelope<unknown>;
    if (env && typeof env === 'object' && 'data' in env) {
      res.data = env.data;
    }
    return res;
  },
  (err: AxiosError<ApiEnvelope<unknown> | { error?: unknown; message?: string }>) => {
    const status = err.response?.status;
    const payload = err.response?.data as { error?: unknown; message?: string } | undefined;
    const detail =
      typeof payload?.error === 'string'
        ? payload.error
        : payload?.error
          ? JSON.stringify(payload.error)
          : payload?.message || err.message;

    if (status === 401) {
      setAccessToken(null);
      ElMessage.error('登录已失效,请重新登录');
      // Avoid hard reload on the login page itself.
      if (location.pathname !== '/login') location.href = '/login';
    } else {
      ElMessage.error(`请求失败: ${detail}`);
    }
    return Promise.reject(new Error(detail));
  },
);
