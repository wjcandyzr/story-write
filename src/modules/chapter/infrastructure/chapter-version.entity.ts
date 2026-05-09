import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type ChapterVersionReason =
  | 'initial'           // 第一次生成
  | 'rewrite'           // 用户主动重新生成
  | 'continuity_fix'    // 连续性检查 → 自动修订
  | 'manual';           // 用户在编辑器里手改后保存

export interface ContinuityIssueSnapshot {
  id?: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggestion?: string;
  characterId?: string;
  status?: 'active' | 'resolved' | 'new';
  appearedAt?: string;
  resolvedAt?: string;
}

@Entity({ name: 'chapter_versions' })
@Unique(['chapterId', 'versionNumber'])
export class ChapterVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'chapter_id' })
  chapterId!: string;

  /** 自增,从 1 开始;每个章节独立计数。 */
  @Column({ name: 'version_number', type: 'int' })
  versionNumber!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'word_count', type: 'int', default: 0 })
  wordCount!: number;

  @Column({ type: 'text', nullable: true, name: 'context_summary' })
  contextSummary!: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'continuity_issues' })
  continuityIssues!: ContinuityIssueSnapshot[] | null;

  @Column({ type: 'varchar', length: 32 })
  reason!: ChapterVersionReason;

  /** 用户在 UI 上备注此版本是什么(可选)。 */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
