import { http } from './client';
import type { Chapter, ChapterStatus, ChapterVersion, Paginated } from '@/types/api';

export interface CreateChapterDto {
  title: string;
  outline?: string;
  chapterNumber?: number;
}

/** PATCH /chapters/:id 接受 CreateChapterDto 全部字段 + status 切换。 */
export type UpdateChapterDto = Partial<CreateChapterDto> & {
  status?: ChapterStatus;
  content?: string;
};

export const chapterApi = {
  create: (novelId: string, body: CreateChapterDto) =>
    http.post<Chapter>(`/novels/${novelId}/chapters`, body).then((r) => r.data),

  list: (novelId: string, page = 1, pageSize = 50) =>
    http
      .get<Paginated<Chapter>>(`/novels/${novelId}/chapters`, { params: { page, pageSize } })
      .then((r) => r.data),

  detail: (novelId: string, id: string) =>
    http.get<Chapter>(`/novels/${novelId}/chapters/${id}`).then((r) => r.data),

  update: (novelId: string, id: string, patch: UpdateChapterDto) =>
    http.patch<Chapter>(`/novels/${novelId}/chapters/${id}`, patch).then((r) => r.data),

  remove: (novelId: string, id: string) =>
    http.delete<void>(`/novels/${novelId}/chapters/${id}`).then((r) => r.data),

  draftOutline: (novelId: string, body: { title: string; hints?: string }) =>
    http
      .post<{ outline: string; themesUsed: string[]; chapterNumber: number }>(
        `/novels/${novelId}/chapters/draft-outline`,
        body,
      )
      .then((r) => r.data),

  draftTitle: (
    novelId: string,
    body: { outlineHint?: string; extraHints?: string } = {},
  ) =>
    http
      .post<{ title: string; chapterNumber: number }>(
        `/novels/${novelId}/chapters/draft-title`,
        body,
      )
      .then((r) => r.data),

  // ===== version history =====
  listVersions: (novelId: string, chapterId: string) =>
    http
      .get<ChapterVersion[]>(`/novels/${novelId}/chapters/${chapterId}/versions`)
      .then((r) => r.data),

  getVersion: (novelId: string, chapterId: string, versionId: string) =>
    http
      .get<ChapterVersion>(`/novels/${novelId}/chapters/${chapterId}/versions/${versionId}`)
      .then((r) => r.data),

  restoreVersion: (novelId: string, chapterId: string, versionId: string) =>
    http
      .post<Chapter>(`/novels/${novelId}/chapters/${chapterId}/versions/${versionId}/restore`)
      .then((r) => r.data),
};
