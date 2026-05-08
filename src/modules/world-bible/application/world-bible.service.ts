import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorldBibleEntry } from '../infrastructure/world-bible.entity';
import { NovelService } from '../../novel/application/novel.service';
import { Paginated, PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class WorldBibleService {
  constructor(
    @InjectRepository(WorldBibleEntry) private readonly repo: Repository<WorldBibleEntry>,
    private readonly novels: NovelService,
  ) {}

  private async assertOwnership(novelId: string, ownerId: string) {
    await this.novels.getOwned(novelId, ownerId);
  }

  async create(ownerId: string, novelId: string, input: Partial<WorldBibleEntry>) {
    await this.assertOwnership(novelId, ownerId);
    const entry = this.repo.create({ ...input, novelId });
    return this.repo.save(entry);
  }

  async list(ownerId: string, novelId: string, p: PaginationDto): Promise<Paginated<WorldBibleEntry>> {
    await this.assertOwnership(novelId, ownerId);
    const [items, total] = await this.repo.findAndCount({
      where: { novelId },
      order: { importance: 'DESC', updatedAt: 'DESC' },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
    });
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  /** All entries for a novel — used by agents (no pagination). */
  async findAllForNovel(novelId: string) {
    return this.repo.find({ where: { novelId }, order: { importance: 'DESC' } });
  }

  async getOwned(ownerId: string, novelId: string, id: string): Promise<WorldBibleEntry> {
    await this.assertOwnership(novelId, ownerId);
    const entry = await this.repo.findOneBy({ id, novelId });
    if (!entry) throw new NotFoundException(`World bible entry ${id} not found`);
    return entry;
  }

  async update(ownerId: string, novelId: string, id: string, patch: Partial<WorldBibleEntry>) {
    const entry = await this.getOwned(ownerId, novelId, id);
    Object.assign(entry, patch);
    return this.repo.save(entry);
  }

  async remove(ownerId: string, novelId: string, id: string) {
    const entry = await this.getOwned(ownerId, novelId, id);
    await this.repo.remove(entry);
  }
}
