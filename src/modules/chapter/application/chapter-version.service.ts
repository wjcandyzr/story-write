import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ChapterVersionEntity,
  ChapterVersionReason,
  ContinuityIssueSnapshot,
} from '../infrastructure/chapter-version.entity';
import { ChapterEntity } from '../infrastructure/chapter.entity';
import { NovelService } from '../../novel/application/novel.service';

@Injectable()
export class ChapterVersionService {
  constructor(
    @InjectRepository(ChapterVersionEntity)
    private readonly repo: Repository<ChapterVersionEntity>,
    @InjectRepository(ChapterEntity)
    private readonly chapterRepo: Repository<ChapterEntity>,
    private readonly novels: NovelService,
  ) {}

  /**
   * Internal helper for the orchestrator — takes a freshly generated
   * chapter draft and stores a snapshot row. No ownership check (the
   * caller is the LangGraph orchestrator, not the user).
   */
  async snapshot(input: {
    chapterId: string;
    content: string;
    contextSummary?: string | null;
    continuityIssues?: ContinuityIssueSnapshot[] | null;
    reason: ChapterVersionReason;
    note?: string;
  }): Promise<ChapterVersionEntity> {
    const last = await this.repo
      .createQueryBuilder('v')
      .where('v.chapterId = :id', { id: input.chapterId })
      .orderBy('v.versionNumber', 'DESC')
      .getOne();

    const versionNumber = (last?.versionNumber ?? 0) + 1;
    return this.repo.save(
      this.repo.create({
        chapterId: input.chapterId,
        versionNumber,
        content: input.content,
        wordCount: countWords(input.content),
        contextSummary: input.contextSummary ?? null,
        continuityIssues: input.continuityIssues ?? null,
        reason: input.reason,
        note: input.note ?? null,
      }),
    );
  }

  async listForChapter(ownerId: string, novelId: string, chapterId: string) {
    await this.assertOwnership(ownerId, novelId, chapterId);
    return this.repo.find({
      where: { chapterId },
      order: { versionNumber: 'DESC' },
    });
  }

  async getOne(ownerId: string, novelId: string, chapterId: string, versionId: string) {
    await this.assertOwnership(ownerId, novelId, chapterId);
    const v = await this.repo.findOneBy({ id: versionId, chapterId });
    if (!v) throw new NotFoundException(`Version ${versionId} not found`);
    return v;
  }

  /**
   * Restore: copy the snapshot's content back into the live chapter row.
   * The current state is first snapshotted as a `manual` version so nothing
   * is ever destroyed.
   */
  async restore(
    ownerId: string,
    novelId: string,
    chapterId: string,
    versionId: string,
  ) {
    const target = await this.getOne(ownerId, novelId, chapterId, versionId);
    const live = await this.chapterRepo.findOneBy({ id: chapterId });
    if (!live) throw new NotFoundException(`Chapter ${chapterId} not found`);

    // 先把当前状态留个痕迹,免得用户回滚后想再回到此刻就回不去了。
    if (live.content) {
      await this.snapshot({
        chapterId,
        content: live.content,
        contextSummary: live.contextSummary,
        continuityIssues: live.continuityIssues,
        reason: 'manual',
        note: `自动备份(回滚到 v${target.versionNumber} 之前)`,
      });
    }

    live.content = target.content;
    live.contextSummary = target.contextSummary;
    live.continuityIssues = target.continuityIssues;
    live.wordCount = target.wordCount;
    await this.chapterRepo.save(live);

    return live;
  }

  private async assertOwnership(ownerId: string, novelId: string, chapterId: string) {
    await this.novels.getOwned(novelId, ownerId);
    const ch = await this.chapterRepo.findOneBy({ id: chapterId, novelId });
    if (!ch) throw new NotFoundException(`Chapter ${chapterId} not found`);
  }
}

function countWords(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[一-鿿]/g)?.length ?? 0;
  const latin = text.replace(/[一-鿿]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return cjk + latin;
}
