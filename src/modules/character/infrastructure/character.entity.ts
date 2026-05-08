import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CharacterRoleType {
  PROTAGONIST = 'protagonist',
  ANTAGONIST = 'antagonist',
  SUPPORTING = 'supporting',
  MINOR = 'minor',
}

@Entity({ name: 'characters' })
export class CharacterEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'novel_id' })
  novelId!: string;

  @Column()
  name!: string;

  @Column({ type: 'enum', enum: CharacterRoleType, default: CharacterRoleType.SUPPORTING })
  roleType!: CharacterRoleType;

  @Column({ type: 'text', nullable: true })
  appearance!: string | null;

  @Column({ type: 'text', nullable: true })
  personality!: string | null;

  @Column({ type: 'text', nullable: true })
  background!: string | null;

  @Column({ type: 'text', nullable: true })
  goal!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  relationships!: { characterId: string; relation: string; note?: string }[] | null;

  @Column({ type: 'jsonb', nullable: true, name: 'arc_state' })
  arcState!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
