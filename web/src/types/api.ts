// 后端响应统一外层
export interface ApiEnvelope<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// === domain ===

export interface AuthUser {
  id: string;
  username: string;
  roles: string[];
}

export interface AuthResult {
  accessToken: string;
  user: AuthUser;
}

export type NovelStatus = 'draft' | 'writing' | 'completed' | 'archived';

export interface Novel {
  id: string;
  ownerId: string;
  title: string;
  synopsis: string | null;
  genres: string[] | null;
  status: NovelStatus;
  targetWordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Theme {
  id: string;
  novelId: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  priority: number;
  previousDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolishResult {
  original: string;
  polished: string;
  contextType: string;
  notes?: string;
  theme?: Theme;
}

export type ChapterStatus = 'planned' | 'generating' | 'draft' | 'reviewed' | 'published';

export type ContinuityIssueStatus = 'active' | 'resolved' | 'new';

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

export interface Chapter {
  id: string;
  novelId: string;
  chapterNumber: number;
  title: string;
  outline: string | null;
  content: string | null;
  contextSummary: string | null;
  wordCount: number;
  status: ChapterStatus;
  continuityIssues: ContinuityIssue[] | null;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ChapterVersionReason = 'initial' | 'rewrite' | 'continuity_fix' | 'manual';

export interface ChapterVersion {
  id: string;
  chapterId: string;
  versionNumber: number;
  content: string;
  wordCount: number;
  contextSummary: string | null;
  continuityIssues: ContinuityIssue[] | null;
  reason: ChapterVersionReason;
  note: string | null;
  createdAt: string;
}
