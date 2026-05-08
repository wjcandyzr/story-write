import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PromptScope, PromptTemplate } from '../infrastructure/prompt-template.entity';
import { Paginated, PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class PromptTemplateService {
  constructor(@InjectRepository(PromptTemplate) private readonly repo: Repository<PromptTemplate>) {}

  async create(ownerId: string, input: Partial<PromptTemplate>) {
    const tpl = this.repo.create({ ...input, ownerId, version: input.version ?? 1 });
    return this.repo.save(tpl);
  }

  async list(ownerId: string, p: PaginationDto): Promise<Paginated<PromptTemplate>> {
    // Surface both user-owned and system templates.
    const [items, total] = await this.repo.findAndCount({
      where: [{ ownerId }, { ownerId: IsNull() }],
      order: { updatedAt: 'DESC' },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
    });
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async getById(id: string) {
    const tpl = await this.repo.findOneBy({ id });
    if (!tpl) throw new NotFoundException(`Template ${id} not found`);
    return tpl;
  }

  /** Resolve the active template for a scope, prefer user-owned over system. */
  async resolveActive(scope: PromptScope, ownerId: string | null): Promise<PromptTemplate> {
    if (ownerId) {
      const own = await this.repo.findOne({
        where: { scope, active: true, ownerId },
        order: { version: 'DESC' },
      });
      if (own) return own;
    }
    const sys = await this.repo.findOne({
      where: { scope, active: true, ownerId: IsNull() },
      order: { version: 'DESC' },
    });
    if (!sys) throw new NotFoundException(`No active template for scope=${scope}`);
    return sys;
  }

  async update(id: string, ownerId: string, patch: Partial<PromptTemplate>) {
    const tpl = await this.getById(id);
    if (tpl.ownerId !== ownerId) throw new NotFoundException(`Template ${id} not found`);
    Object.assign(tpl, patch);
    return this.repo.save(tpl);
  }

  async remove(id: string, ownerId: string) {
    const tpl = await this.getById(id);
    if (tpl.ownerId !== ownerId) throw new NotFoundException(`Template ${id} not found`);
    await this.repo.remove(tpl);
  }

  /** Render `{var}` placeholders. Missing vars become empty string. */
  static render(template: string, vars: Record<string, string | number | undefined>) {
    return template.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vars[k];
      return v === undefined || v === null ? '' : String(v);
    });
  }
}
