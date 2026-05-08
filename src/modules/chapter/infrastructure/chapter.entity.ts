import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum ChapterStatus {
  PLANNED = 'planned',
  GENERATING = 'generating',
  DRAFT = 'draft',
  REVIEWED = 'reviewed',
  PUBLISHED = 'published',
}

@Entity({ name: 'chapters' })
@Unique(['novelId', 'chapterNumber'])
export class ChapterEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'novel_id' })
  novelId!: string;

  @Column({ name: 'chapter_number', type: 'int' })
  chapterNumber!: number;

  @Column()
  title!: string;

  /** Plot beats supplied by user or by the plot-planner agent. */
  @Column({ type: 'text', nullable: true })
  outline!: string | null;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  /** Compressed memory from earlier chapters used as context. */
  @Column({ type: 'text', nullable: true, name: 'context_summary' })
  contextSummary!: string | null;

  @Column({ name: 'word_count', type: 'int', default: 0 })
  wordCount!: number;

  @Column({ type: 'enum', enum: ChapterStatus, default: ChapterStatus.PLANNED })
  status!: ChapterStatus;

  /** Continuity issues detected by checker agent. */
  @Column({ type: 'jsonb', nullable: true, name: 'continuity_issues' })
  continuityIssues!: { severity: string; message: string; suggestion?: string }[] | null;

  /** Last LangGraph thread id used for resumable runs. */
  @Column({ name: 'thread_id', type: 'varchar', length: 64, nullable: true })
  threadId!: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
