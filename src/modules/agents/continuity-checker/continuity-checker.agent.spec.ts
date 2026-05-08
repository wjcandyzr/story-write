import { ContinuityCheckerAgent } from './continuity-checker.agent';

// We exercise the parser directly by stubbing LlmService output.
describe('ContinuityCheckerAgent.check', () => {
  const tpls: any = {
    resolveActive: jest.fn(),
  };

  function mkAgent(raw: string) {
    const llm = { complete: jest.fn().mockResolvedValue(raw) } as any;
    return new ContinuityCheckerAgent(llm, tpls);
  }

  beforeEach(() => {
    tpls.resolveActive.mockRejectedValue(new Error('no template')); // force in-code fallback
  });

  it('parses a JSON array of issues', async () => {
    const agent = mkAgent(
      'sure, here:\n[{"severity":"warning","message":"林风 hair color drift"},{"severity":"info","message":"ok"}]',
    );
    const issues = await agent.check({
      chapterContent: 'x',
      bible: [],
      characters: [],
      contextSummary: '',
      ownerId: 'u',
    });
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ severity: 'warning', message: '林风 hair color drift' });
  });

  it('coerces unknown severity to warning', async () => {
    const agent = mkAgent('[{"severity":"critical","message":"x"}]');
    const issues = await agent.check({
      chapterContent: '',
      bible: [],
      characters: [],
      contextSummary: '',
      ownerId: 'u',
    });
    expect(issues[0].severity).toBe('warning');
  });

  it('returns empty array on malformed output', async () => {
    const agent = mkAgent('not json at all');
    const issues = await agent.check({
      chapterContent: '',
      bible: [],
      characters: [],
      contextSummary: '',
      ownerId: 'u',
    });
    expect(issues).toEqual([]);
  });
});
