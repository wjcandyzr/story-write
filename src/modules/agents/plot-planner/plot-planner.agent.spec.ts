import { PlotPlannerAgent } from './plot-planner.agent';

describe('PlotPlannerAgent.plan', () => {
  function mk(raw: string) {
    const llm = { complete: jest.fn().mockResolvedValue(raw) } as any;
    const tpls: any = { resolveActive: jest.fn().mockRejectedValue(new Error('fallback')) };
    return new PlotPlannerAgent(llm, tpls);
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
