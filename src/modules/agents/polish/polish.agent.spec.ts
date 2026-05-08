import { PolishAgent, PolishContextType } from './polish.agent';

describe('PolishAgent.polish', () => {
  function mk(raw: string) {
    const llm = { complete: jest.fn().mockResolvedValue(raw) } as any;
    const tpls: any = { resolveActive: jest.fn().mockRejectedValue(new Error('use fallback')) };
    const novels: any = { getOwned: jest.fn() };
    const bible: any = { findAllForNovel: jest.fn().mockResolvedValue([]) };
    return new PolishAgent(llm, tpls, novels, bible);
  }

  const baseInput = {
    text: '主角在末世里求生。',
    contextType: PolishContextType.THEME,
    ownerId: 'u',
  };

  it('extracts <polished> + <notes> blocks', async () => {
    const agent = mk(
      'whatever pre-amble\n<polished>主角在丧尸围城的末世里挣扎求生,寻找传说中的避风港。</polished>\n<notes>我加强了画面感和悬念。</notes>',
    );
    const res = await agent.polish(baseInput);
    expect(res.polished).toContain('挣扎求生');
    expect(res.notes).toBe('我加强了画面感和悬念。');
    expect(res.original).toBe(baseInput.text);
    expect(res.contextType).toBe(PolishContextType.THEME);
  });

  it('falls back to whole-string when no <polished> tag', async () => {
    const agent = mk('主角在末世里挣扎求生。');
    const res = await agent.polish(baseInput);
    expect(res.polished).toBe('主角在末世里挣扎求生。');
    expect(res.notes).toBeUndefined();
  });

  it('skips novel context loading when novelId is omitted', async () => {
    const agent = mk('<polished>x</polished>');
    await agent.polish(baseInput);
    // novels.getOwned and bible.findAllForNovel were never invoked because novelId was missing
    expect((agent as any).novels.getOwned).not.toHaveBeenCalled();
    expect((agent as any).bible.findAllForNovel).not.toHaveBeenCalled();
  });

  it('survives novel context load failure (uses empty digest)', async () => {
    const agent = mk('<polished>ok</polished>');
    (agent as any).novels.getOwned.mockRejectedValueOnce(new Error('not found'));
    const res = await agent.polish({ ...baseInput, novelId: 'novel-1' });
    expect(res.polished).toBe('ok'); // didn't crash
  });
});
