import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NovelService } from './novel.service';
import { NovelEntity, NovelStatus } from '../infrastructure/novel.entity';

describe('NovelService', () => {
  let svc: NovelService;
  let repo: { create: jest.Mock; save: jest.Mock; findOneBy: jest.Mock; findAndCount: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn(async (x) => ({ ...x, id: x.id ?? 'novel-1' })),
      findOneBy: jest.fn(),
      findAndCount: jest.fn(),
      remove: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [NovelService, { provide: getRepositoryToken(NovelEntity), useValue: repo }],
    }).compile();
    svc = moduleRef.get(NovelService);
  });

  it('creates a novel with DRAFT status by default', async () => {
    const n = await svc.create('user-1', { title: 'My Tale', synopsis: 's' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'user-1', title: 'My Tale', status: NovelStatus.DRAFT }),
    );
    expect(n.id).toBe('novel-1');
  });

  it('throws NotFound when novel missing', async () => {
    repo.findOneBy.mockResolvedValueOnce(null);
    await expect(svc.getOwned('x', 'u')).rejects.toThrow(NotFoundException);
  });

  it('throws Forbidden for foreign novel', async () => {
    repo.findOneBy.mockResolvedValueOnce({ id: 'x', ownerId: 'other' });
    await expect(svc.getOwned('x', 'me')).rejects.toThrow(ForbiddenException);
  });

  it('lists with pagination', async () => {
    repo.findAndCount.mockResolvedValueOnce([[{ id: 'n1' }], 1]);
    const res = await svc.list('u', { page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
  });
});
