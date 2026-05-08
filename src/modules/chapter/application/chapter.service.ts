import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ChapterEntity, ChapterStatus } from '../infrastructure/chapter.entity';
import { NovelService } from '../../novel/application/novel.service';
import { Paginated, PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class ChapterService {
  constructor(
    @InjectRepository(ChapterEntity) private readonly repo: Repository<ChapterEntity>,
    private readonly novels: NovelService,
  ) {}

  private async assertOwnership(novelId: string, ownerId: string) {
    await this.novels.getOwned(novelId, ownerId);
  }

  async create(ownerId: string, novelId: string, input: Partial<ChapterEntity>) {
    await this.assertOwnership(novelId, ownerId);
    const next = (await this.repo.maximum('chapterNumber', { novelId })) ?? 0;
    const c = this.repo.create({
      ...input,
      novelId,
      chapterNumber: input.chapterNumber ?? next + 1,
      status: input.status ?? ChapterStatus.PLANNED,
    });
    return this.repo.save(c);
  }

  async list(ownerId: string, novelId: string, p: PaginationDto): Promise<Paginated<ChapterEntity>> {
    await this.assertOwnership(novelId, ownerId);
    const [items, total] = await this.repo.findAndCount({
      where: { novelId },
      order: { chapterNumber: 'ASC' },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
    });
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async getOwned(ownerId: string, novelId: string, id: string) {
    await this.assertOwnership(novelId, ownerId);
    const c = await this.repo.findOneBy({ id, novelId });
    if (!c) throw new NotFoundException(`Chapter ${id} not found`);
    return c;
  }

  /** Used by agents — no permission check, internal callers only. */
  findById(id: string) {
    return this.repo.findOneBy({ id });
  }

  /** Previously published / drafted chapters before the current one. */
  findPrevious(novelId: string, chapterNumber: number) {
    return this.repo.find({
      where: { novelId, chapterNumber: LessThan(chapterNumber) },
      order: { chapterNumber: 'ASC' },
    });
  }

  async update(ownerId: string, novelId: string, id: string, patch: Partial<ChapterEntity>) {
    const c = await this.getOwned(ownerId, novelId, id);
    Object.assign(c, patch);
    if (patch.content !== undefined) c.wordCount = countWords(patch.content ?? '');
    return this.repo.save(c);
  }

  /** Internal mutation used by agents — bypasses ownership check. */
  async patchInternal(id: string, patch: Partial<ChapterEntity>) {
    const c = await this.repo.findOneBy({ id });
    if (!c) throw new NotFoundException(`Chapter ${id} not found`);
    Object.assign(c, patch);
    if (patch.content !== undefined) c.wordCount = countWords(patch.content ?? '');
    return this.repo.save(c);
  }

  async remove(ownerId: string, novelId: string, id: string) {
    const c = await this.getOwned(ownerId, novelId, id);
    await this.repo.remove(c);
  }
}

function countWords(text: string): number {
  if (!text) return 0;
  // Mixed CJK + Latin: count CJK chars individually + whitespace-split for the rest.
  const cjk = text.match(/[一-鿿]/g)?.length ?? 0;
  const latin = text.replace(/[一-鿿]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return cjk + latin;
}
