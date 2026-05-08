import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ThemeEntity } from '../infrastructure/theme.entity';
import { NovelService } from '../../novel/application/novel.service';
import { Paginated, PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class ThemeService {
  constructor(
    @InjectRepository(ThemeEntity) private readonly repo: Repository<ThemeEntity>,
    private readonly novels: NovelService,
  ) {}

  private async assertOwnership(novelId: string, ownerId: string) {
    await this.novels.getOwned(novelId, ownerId);
  }

  async create(ownerId: string, novelId: string, input: Partial<ThemeEntity>) {
    await this.assertOwnership(novelId, ownerId);
    const t = this.repo.create({ ...input, novelId });
    return this.repo.save(t);
  }

  async list(ownerId: string, novelId: string, p: PaginationDto): Promise<Paginated<ThemeEntity>> {
    await this.assertOwnership(novelId, ownerId);
    const [items, total] = await this.repo.findAndCount({
      where: { novelId },
      order: { priority: 'DESC', updatedAt: 'DESC' },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
    });
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  /** Used by agents — full set, no pagination, no permission check. */
  findAllForNovel(novelId: string) {
    return this.repo.find({ where: { novelId }, order: { priority: 'DESC' } });
  }

  async getOwned(ownerId: string, novelId: string, id: string) {
    await this.assertOwnership(novelId, ownerId);
    const t = await this.repo.findOneBy({ id, novelId });
    if (!t) throw new NotFoundException(`Theme ${id} not found`);
    return t;
  }

  async update(ownerId: string, novelId: string, id: string, patch: Partial<ThemeEntity>) {
    const t = await this.getOwned(ownerId, novelId, id);
    Object.assign(t, patch);
    return this.repo.save(t);
  }

  async remove(ownerId: string, novelId: string, id: string) {
    const t = await this.getOwned(ownerId, novelId, id);
    await this.repo.remove(t);
  }

  /**
   * Apply a polished version produced by PolishAgent: snapshot the previous
   * description into `previousDescription`, then write the new one. This
   * lets the user roll back via revertPolish if the result is bad.
   */
  async applyPolish(ownerId: string, novelId: string, id: string, polished: string) {
    const t = await this.getOwned(ownerId, novelId, id);
    t.previousDescription = t.description;
    t.description = polished;
    return this.repo.save(t);
  }

  async revertPolish(ownerId: string, novelId: string, id: string) {
    const t = await this.getOwned(ownerId, novelId, id);
    if (t.previousDescription === null) throw new NotFoundException('No previous version to revert to');
    const tmp = t.description;
    t.description = t.previousDescription;
    t.previousDescription = tmp;
    return this.repo.save(t);
  }
}
