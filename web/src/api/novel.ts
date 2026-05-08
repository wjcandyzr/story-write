import { http } from './client';
import type { Novel, Paginated } from '@/types/api';

export interface CreateNovelDto {
  title: string;
  synopsis?: string;
  genres?: string[];
  targetWordCount?: number;
}

export const novelApi = {
  create: (body: CreateNovelDto) => http.post<Novel>('/novels', body).then((r) => r.data),

  list: (page = 1, pageSize = 20) =>
    http
      .get<Paginated<Novel>>('/novels', { params: { page, pageSize } })
      .then((r) => r.data),

  detail: (id: string) => http.get<Novel>(`/novels/${id}`).then((r) => r.data),

  update: (id: string, patch: Partial<CreateNovelDto>) =>
    http.patch<Novel>(`/novels/${id}`, patch).then((r) => r.data),

  remove: (id: string) => http.delete<void>(`/novels/${id}`).then((r) => r.data),
};
