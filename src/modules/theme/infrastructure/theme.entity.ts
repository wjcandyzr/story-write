import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'themes' })
export class ThemeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'novel_id' })
  novelId!: string;

  /** 短名,例如 "末世废土"、"宫斗权谋"。 */
  @Column()
  name!: string;

  /** 多行描述,这是用户写完后会去润色的字段。 */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** 自由 tag 列表,例如 ["丧尸", "末日生存", "硬科幻"]。 */
  @Column({ type: 'simple-array', nullable: true })
  tags!: string[] | null;

  /** 1~10,影响生成时是否注入到 prompt context。 */
  @Column({ type: 'int', default: 5 })
  priority!: number;

  /** 用户每次润色后,把上一版描述存到这里,可点击回滚。 */
  @Column({ type: 'text', nullable: true, name: 'previous_description' })
  previousDescription!: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
