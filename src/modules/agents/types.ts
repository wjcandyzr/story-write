/** Streaming events emitted by the chapter orchestrator. */
export type AgentStreamEvent =
  | {
      type: 'phase';
      phase: 'plan' | 'compress' | 'generate' | 'continuity' | 'rewrite' | 'persist';
      detail?: string;
    }
  | { type: 'token'; value: string }
  /** 模型的思考链(thinking 模式),独立于正文呈现。 */
  | { type: 'reasoning'; value: string }
  /**
   * 让前端**清空**当前正文区域并替换成 value。重写流程结束时用,
   * 这样不会出现"原稿 + 重写稿"叠在一起的视觉污染。
   */
  | { type: 'replace'; value: string }
  | { type: 'continuity'; payload: { issues: ContinuityIssue[] } };

export type ContinuityIssueStatus = 'active' | 'resolved' | 'new';

/**
 * 连续性问题。`status` 表示这条问题在多轮检查/重写之间的生命周期:
 *   active   - 第一次发现并仍存在
 *   resolved - 第一稿发现的问题,在 AI 修订后已消失(显示绿色勾)
 *   new      - 第一稿没有,但修订后才冒出来的(可能是 AI 改坏了)
 *
 * id 是我们生成的稳定 uuid,跨快照不会变,前端可以稳定地 key=id。
 */
export interface ContinuityIssue {
  id?: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggestion?: string;
  characterId?: string;
  status?: ContinuityIssueStatus;
  appearedAt?: string;
  resolvedAt?: string;
}

export interface ChapterRunInput {
  novelId: string;
  chapterId: string;
  ownerId: string;
  threadId?: string;
  extraInstructions?: string;
}

export interface PlotPlan {
  beats: { title: string; summary: string }[];
  hook: string;
  cliffhanger: string;
}
