import { onUnmounted, ref } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth';
import type { ContinuityIssue } from '@/types/api';

export type ChapterPhase = 'compress' | 'plan' | 'generate' | 'continuity' | 'rewrite' | 'persist';

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
  /** 模型思考链,与 content 分开累加。仅在思考模式启用时才会出现内容。 */
  const reasoning = ref('');
  const issues = ref<ContinuityIssue[]>([]);
  const errorMsg = ref<string | null>(null);
  /**
   * 当前后台在为哪一章生成。用来让 UI 与"用户选中的章节"解耦 ——
   * 用户切到别的章节时,生成在后台继续,只有当 streamingChapterId 等于
   * 当前选中章节 id 时才在主视图渲染流式内容。
   * 生成结束/出错/取消时清回 null。
   */
  const streamingChapterId = ref<string | null>(null);

  let socket: Socket | null = null;

  function reset() {
    phase.value = null;
    content.value = '';
    reasoning.value = '';
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
    streamingChapterId.value = opts.chapterId;

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
    socket.on('chapter:reasoning', (e: { value: string }) => { reasoning.value += e.value; });
    // 后端连续性自动修订完成后,会发 chapter:replace 让前端整段替换
    // (而不是 token 累加)。重写后的全文 = e.value
    socket.on('chapter:replace', (e: { value: string }) => { content.value = e.value; });
    socket.on('chapter:continuity', (e: { issues: ContinuityIssue[] }) => {
      issues.value = e.issues ?? [];
    });
    socket.on('chapter:done', () => {
      generating.value = false;
      streamingChapterId.value = null;
      socket?.disconnect();
    });
    socket.on('chapter:cancelled', () => {
      generating.value = false;
      streamingChapterId.value = null;
      socket?.disconnect();
    });
    socket.on('chapter:error', (e: { message: string }) => {
      errorMsg.value = e.message;
      generating.value = false;
      streamingChapterId.value = null;
      socket?.disconnect();
    });
  }

  function cancel() {
    socket?.emit('chapter:cancel');
  }

  onUnmounted(() => {
    socket?.disconnect();
  });

  return {
    connected,
    generating,
    phase,
    content,
    reasoning,
    issues,
    errorMsg,
    streamingChapterId,
    start,
    cancel,
    /** 暴露给消费者:切章节时清掉上一章遗留的流式状态 */
    reset,
  };
}
