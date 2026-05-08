import { http } from './client';
import type { AuthResult, AuthUser } from '@/types/api';

export const authApi = {
  register: (body: { username: string; email: string; password: string }) =>
    http.post<AuthResult>('/auth/register', body).then((r) => r.data),

  login: (body: { username: string; password: string }) =>
    http.post<AuthResult>('/auth/login', body).then((r) => r.data),

  me: () => http.get<AuthUser>('/auth/me').then((r) => r.data),
};
