import { onUnmounted, ref } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth';
import type { ContinuityIssue } from '@/types/api';

export type ChapterPhase = 'compress' | 'plan' | 'generate' | 'continuity' | 'persist';

/**
 * Reactive wrapper around the `/ws` Socket.IO namespace's chapter:* events.
 * Keeps `content`, `phase`, `issues` etc. in refs so views just bind them.
 */
export function useChapterSocket() {
  const auth = useAuthStore();

  const connected = ref(false);
  const generating = ref(false);
  const phase = ref<ChapterPhase | null>(null);
  const content = ref('');
  const issues = ref<ContinuityIssue[]>([]);
  const errorMsg = ref<string | null>(null);

  let socket: Socket | null = null;

  function reset() {
    phase.value = null;
    content.value = '';
    issues.value = [];
    errorMsg.value = null;
  }

  function start(opts: { novelId: string; chapterId: string; extraInstructions?: string }) {
    if (generating.value) return;
    if (!auth.token) {
      errorMsg.value = '未登录';
      return;
    }
    reset();
    generating.value = true;

    // Vite dev proxy forwards /ws to nest at :3000, so same-origin works.
    socket = io(`${location.origin}/ws`, {
      auth: { token: auth.token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      connected.value = true;
      socket!.emit('chapter:generate', opts);
    });
    socket.on('disconnect', () => { connected.value = false; });

    socket.on('chapter:phase', (e: { phase: ChapterPhase }) => { phase.value = e.phase; });
    socket.on('chapter:token', (e: { value: string }) => { content.value += e.value; });
    socket.on('chapter:continuity', (e: { issues: ContinuityIssue[] }) => {
      issues.value = e.issues ?? [];
    });
    socket.on('chapter:done', () => {
      generating.value = false;
      socket?.disconnect();
    });
    socket.on('chapter:cancelled', () => {
      generating.value = false;
      socket?.disconnect();
    });
    socket.on('chapter:error', (e: { message: string }) => {
      errorMsg.value = e.message;
      generating.value = false;
      socket?.disconnect();
    });
  }

  function cancel() {
    socket?.emit('chapter:cancel');
  }

  onUnmounted(() => {
    socket?.disconnect();
  });

  return { connected, generating, phase, content, issues, errorMsg, start, cancel };
}
