import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum PromptScope {
  PLOT_PLANNER = 'plot_planner',
  CONTENT_GENERATOR = 'content_generator',
  CONTEXT_COMPRESSOR = 'context_compressor',
  CONTINUITY_CHECKER = 'continuity_checker',
  GENERIC = 'generic',
}

@Entity({ name: 'prompt_templates' })
@Unique(['ownerId', 'name', 'version'])
export class PromptTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Null ownerId = system / built-in template available to everyone. */
  @Index()
  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId!: string | null;

  @Column()
  name!: string;

  @Column({ type: 'enum', enum: PromptScope, default: PromptScope.GENERIC })
  scope!: PromptScope;

  @Column({ type: 'text' })
  systemPrompt!: string;

  @Column({ type: 'text' })
  userTemplate!: string;

  /** List of declared variable names — `{name}` placeholders. */
  @Column({ type: 'simple-array', nullable: true })
  variables!: string[] | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
