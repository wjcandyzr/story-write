import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum NovelStatus {
  DRAFT = 'draft',
  WRITING = 'writing',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

@Entity({ name: 'novels' })
export class NovelEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'owner_id' })
  ownerId!: string;

  @Column()
  title!: string;

  @Column({ type: 'text', nullable: true })
  synopsis!: string | null;

  @Column({ type: 'simple-array', nullable: true })
  genres!: string[] | null;

  @Column({ type: 'enum', enum: NovelStatus, default: NovelStatus.DRAFT })
  status!: NovelStatus;

  @Column({ name: 'target_word_count', type: 'int', default: 100000 })
  targetWordCount!: number;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
