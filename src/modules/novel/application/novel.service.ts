import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NovelEntity, NovelStatus } from '../infrastructure/novel.entity';
import { Paginated, PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class NovelService {
  constructor(@InjectRepository(NovelEntity) private readonly repo: Repository<NovelEntity>) {}

  create(ownerId: string, input: Partial<NovelEntity>): Promise<NovelEntity> {
    const entity = this.repo.create({
      ownerId,
      title: input.title!,
      synopsis: input.synopsis ?? null,
      genres: input.genres ?? null,
      targetWordCount: input.targetWordCount ?? 100000,
      status: NovelStatus.DRAFT,
    });
    return this.repo.save(entity);
  }

  async list(ownerId: string, p: PaginationDto): Promise<Paginated<NovelEntity>> {
    const [items, total] = await this.repo.findAndCount({
      where: { ownerId },
      order: { updatedAt: 'DESC' },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
    });
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async getOwned(id: string, ownerId: string): Promise<NovelEntity> {
    const novel = await this.repo.findOneBy({ id });
    if (!novel) throw new NotFoundException(`Novel ${id} not found`);
    if (novel.ownerId !== ownerId) throw new ForbiddenException('Not your novel');
    return novel;
  }

  async update(id: string, ownerId: string, patch: Partial<NovelEntity>): Promise<NovelEntity> {
    const novel = await this.getOwned(id, ownerId);
    Object.assign(novel, patch);
    return this.repo.save(novel);
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const novel = await this.getOwned(id, ownerId);
    await this.repo.remove(novel);
  }
}
