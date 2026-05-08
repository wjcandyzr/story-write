import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WorldBibleCategory {
  GEOGRAPHY = 'geography',
  CULTURE = 'culture',
  MAGIC = 'magic_system',
  TIMELINE = 'timeline',
  FACTION = 'faction',
  RULE = 'rule',
  OTHER = 'other',
}

@Entity({ name: 'world_bible_entries' })
export class WorldBibleEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'novel_id' })
  novelId!: string;

  @Column()
  title!: string;

  @Column({ type: 'enum', enum: WorldBibleCategory, default: WorldBibleCategory.OTHER })
  category!: WorldBibleCategory;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'simple-array', nullable: true })
  tags!: string[] | null;

  /** Higher = more important / always-keep in compressed context. */
  @Column({ name: 'importance', type: 'int', default: 5 })
  importance!: number;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
