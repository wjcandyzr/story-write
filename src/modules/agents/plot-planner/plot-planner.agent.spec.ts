import { PlotPlannerAgent } from './plot-planner.agent';

describe('PlotPlannerAgent.plan', () => {
  function mk(raw: string) {
    const llm = { complete: jest.fn().mockResolvedValue(raw) } as any;
    const tpls: any = { resolveActive: jest.fn().mockRejectedValue(new Error('fallback')) };
    // ThemeEntity repo — only `find` is exercised by draftOutline,
    // but plan() never touches it, so an empty stub is enough here.
    const themeRepo: any = { find: jest.fn().mockResolvedValue([]) };
    return new PlotPlannerAgent(llm, tpls, themeRepo);
  }

  const baseInput = {
    novel: { title: 'T', synopsis: 's' } as any,
    chapter: { chapterNumber: 1, title: 'A', outline: null } as any,
    bible: [],
    characters: [],
    previousSummary: '',
    ownerId: 'u',
  };

  it('parses a strict-JSON plan', async () => {
    const agent = mk('{"beats":[{"title":"b1","summary":"x"}],"hook":"h","cliffhanger":"c"}');
    const plan = await agent.plan(baseInput);
    expect(plan.beats).toHaveLength(1);
    expect(plan.hook).toBe('h');
  });

  it('extracts JSON wrapped in chatter', async () => {
    const agent = mk('Sure: ```json\n{"beats":[],"hook":"h","cliffhanger":""}\n```');
    const plan = await agent.plan(baseInput);
    expect(plan.hook).toBe('h');
  });

  it('falls back to unstructured beat when LLM returns prose', async () => {
    const agent = mk('No JSON here, just thoughts.');
    const plan = await agent.plan(baseInput);
    expect(plan.beats[0].title).toBe('unstructured');
    expect(plan.hook).toBe('');
  });
});

describe('PlotPlannerAgent.draftOutline', () => {
  function mkWithThemes(raw: string, themes: any[]) {
    const llm = { complete: jest.fn().mockResolvedValue(raw) } as any;
    const tpls: any = { resolveActive: jest.fn() };
    const themeRepo: any = { find: jest.fn().mockResolvedValue(themes) };
    return { agent: new PlotPlannerAgent(llm, tpls, themeRepo), llm, themeRepo };
  }

  const baseInput = {
    novel: { id: 'n1', title: '末日', synopsis: '丧尸潮' } as any,
    title: '第三章 转折',
    chapterNumber: 3,
    bible: [],
    characters: [],
    previousDigest: '',
    ownerId: 'u',
  };

  it('returns the LLM text as outline and reports themes used', async () => {
    const { agent } = mkWithThemes('林风第一次在城外遇到丧尸群,...', [
      { name: '末世废土', priority: 8, description: '...', tags: ['丧尸'] },
      { name: '低优先级', priority: 3, description: '不该用', tags: [] },
    ]);
    const res = await agent.draftOutline(baseInput);
    expect(res.outline).toContain('林风');
    // priority < 5 应被过滤掉
    expect(res.themesUsed).toEqual(['末世废土']);
  });

  it('caps usedThemes at 5 even if more high-priority themes exist', async () => {
    const themes = Array.from({ length: 8 }, (_, i) => ({
      name: `T${i}`,
      priority: 9,
      description: 'x',
      tags: [],
    }));
    const { agent } = mkWithThemes('outline', themes);
    const res = await agent.draftOutline(baseInput);
    expect(res.themesUsed).toHaveLength(5);
  });

  it('handles empty theme list gracefully', async () => {
    const { agent } = mkWithThemes('outline only', []);
    const res = await agent.draftOutline(baseInput);
    expect(res.outline).toBe('outline only');
    expect(res.themesUsed).toEqual([]);
  });
});
