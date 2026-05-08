import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChapterService } from './chapter.service';
import { ChapterEntity, ChapterStatus } from '../infrastructure/chapter.entity';
import { NovelService } from '../../novel/application/novel.service';

describe('ChapterService', () => {
  let svc: ChapterService;
  let repo: any;
  let novels: { getOwned: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn(async (x) => ({ ...x, id: x.id ?? 'ch-1' })),
      findOneBy: jest.fn(),
      findAndCount: jest.fn(),
      maximum: jest.fn(),
      find: jest.fn(),
      remove: jest.fn(),
    };
    novels = { getOwned: jest.fn().mockResolvedValue({ id: 'novel-1', ownerId: 'u' }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChapterService,
        { provide: getRepositoryToken(ChapterEntity), useValue: repo },
        { provide: NovelService, useValue: novels },
      ],
    }).compile();
    svc = moduleRef.get(ChapterService);
  });

  it('auto-numbers new chapters from max+1', async () => {
    repo.maximum.mockResolvedValueOnce(4);
    const c = await svc.create('u', 'novel-1', { title: 'Five' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ chapterNumber: 5, status: ChapterStatus.PLANNED }),
    );
    expect(c.id).toBe('ch-1');
  });

  it('starts at chapter 1 when no chapters exist', async () => {
    repo.maximum.mockResolvedValueOnce(null);
    await svc.create('u', 'novel-1', { title: 'First' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ chapterNumber: 1 }));
  });

  it('counts mixed CJK + latin words on update', async () => {
    repo.findOneBy.mockResolvedValueOnce({ id: 'ch-1', novelId: 'novel-1', wordCount: 0 });
    const out = await svc.update('u', 'novel-1', 'ch-1', { content: '林风 走 into the room' });
    // 林风走 = 3 CJK chars + 4 latin tokens = 7
    expect(out.wordCount).toBe(7);
  });
});
