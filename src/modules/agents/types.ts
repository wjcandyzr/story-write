/** Streaming events emitted by the chapter orchestrator. */
export type AgentStreamEvent =
  | { type: 'phase'; phase: 'plan' | 'compress' | 'generate' | 'continuity' | 'persist'; detail?: string }
  | { type: 'token'; value: string }
  | { type: 'continuity'; payload: { issues: ContinuityIssue[] } };

export interface ContinuityIssue {
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggestion?: string;
  characterId?: string;
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
