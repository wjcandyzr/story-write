import { defineStore } from 'pinia';
import { ref } from 'vue';
import { novelApi, type CreateNovelDto } from '@/api/novel';
import type { Novel } from '@/types/api';

export const useNovelStore = defineStore('novel', () => {
  const list = ref<Novel[]>([]);
  const total = ref(0);
  const current = ref<Novel | null>(null);
  const loading = ref(false);

  async function fetchList(page = 1, pageSize = 20) {
    loading.value = true;
    try {
      const res = await novelApi.list(page, pageSize);
      list.value = res.items;
      total.value = res.total;
    } finally {
      loading.value = false;
    }
  }

  async function load(id: string) {
    current.value = await novelApi.detail(id);
    return current.value;
  }

  async function create(dto: CreateNovelDto) {
    const novel = await novelApi.create(dto);
    list.value = [novel, ...list.value];
    total.value += 1;
    return novel;
  }

  async function update(id: string, patch: Partial<CreateNovelDto>) {
    const novel = await novelApi.update(id, patch);
    if (current.value?.id === id) current.value = novel;
    list.value = list.value.map((n) => (n.id === id ? novel : n));
    return novel;
  }

  async function remove(id: string) {
    await novelApi.remove(id);
    list.value = list.value.filter((n) => n.id !== id);
    total.value = Math.max(0, total.value - 1);
    if (current.value?.id === id) current.value = null;
  }

  return { list, total, current, loading, fetchList, load, create, update, remove };
});
