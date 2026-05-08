import { http } from './client';
import type { Paginated, PolishResult, Theme } from '@/types/api';

export interface CreateThemeDto {
  name: string;
  description?: string;
  tags?: string[];
  priority?: number;
}

export const themeApi = {
  create: (novelId: string, body: CreateThemeDto) =>
    http.post<Theme>(`/novels/${novelId}/themes`, body).then((r) => r.data),

  list: (novelId: string, page = 1, pageSize = 50) =>
    http
      .get<Paginated<Theme>>(`/novels/${novelId}/themes`, { params: { page, pageSize } })
      .then((r) => r.data),

  detail: (novelId: string, id: string) =>
    http.get<Theme>(`/novels/${novelId}/themes/${id}`).then((r) => r.data),

  update: (novelId: string, id: string, patch: Partial<CreateThemeDto>) =>
    http.patch<Theme>(`/novels/${novelId}/themes/${id}`, patch).then((r) => r.data),

  remove: (novelId: string, id: string) =>
    http.delete<void>(`/novels/${novelId}/themes/${id}`).then((r) => r.data),

  polish: (novelId: string, id: string, body: { save?: boolean; extraInstructions?: string } = {}) =>
    http
      .post<PolishResult>(`/novels/${novelId}/themes/${id}/polish`, body)
      .then((r) => r.data),

  revert: (novelId: string, id: string) =>
    http.post<Theme>(`/novels/${novelId}/themes/${id}/revert`).then((r) => r.data),
};
