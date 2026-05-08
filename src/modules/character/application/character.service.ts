import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CharacterEntity } from '../infrastructure/character.entity';
import { NovelService } from '../../novel/application/novel.service';
import { Paginated, PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class CharacterService {
  constructor(
    @InjectRepository(CharacterEntity) private readonly repo: Repository<CharacterEntity>,
    private readonly novels: NovelService,
  ) {}

  private async assertOwnership(novelId: string, ownerId: string) {
    await this.novels.getOwned(novelId, ownerId);
  }

  async create(ownerId: string, novelId: string, input: Partial<CharacterEntity>) {
    await this.assertOwnership(novelId, ownerId);
    const c = this.repo.create({ ...input, novelId });
    return this.repo.save(c);
  }

  async list(ownerId: string, novelId: string, p: PaginationDto): Promise<Paginated<CharacterEntity>> {
    await this.assertOwnership(novelId, ownerId);
    const [items, total] = await this.repo.findAndCount({
      where: { novelId },
      order: { roleType: 'ASC', updatedAt: 'DESC' },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
    });
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  /** Used by agents — full set, no pagination. */
  findAllForNovel(novelId: string) {
    return this.repo.find({ where: { novelId } });
  }

  async getOwned(ownerId: string, novelId: string, id: string) {
    await this.assertOwnership(novelId, ownerId);
    const c = await this.repo.findOneBy({ id, novelId });
    if (!c) throw new NotFoundException(`Character ${id} not found`);
    return c;
  }

  async update(ownerId: string, novelId: string, id: string, patch: Partial<CharacterEntity>) {
    const c = await this.getOwned(ownerId, novelId, id);
    Object.assign(c, patch);
    return this.repo.save(c);
  }

  async remove(ownerId: string, novelId: string, id: string) {
    const c = await this.getOwned(ownerId, novelId, id);
    await this.repo.remove(c);
  }

  /** Agent helper: persist arc state delta after a chapter. */
  async patchArcState(novelId: string, characterId: string, delta: Record<string, unknown>) {
    const c = await this.repo.findOneBy({ id: characterId, novelId });
    if (!c) return;
    c.arcState = { ...(c.arcState ?? {}), ...delta };
    await this.repo.save(c);
  }
}
