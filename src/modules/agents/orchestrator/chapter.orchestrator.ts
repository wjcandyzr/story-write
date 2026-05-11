import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { v4 as uuid } from 'uuid';
import { LANGGRAPH_CHECKPOINTER } from '../../../infrastructure/checkpoint/checkpoint.module';
import { NovelService } from '../../novel/application/novel.service';
import { ChapterService } from '../../chapter/application/chapter.service';
import { ChapterVersionService } from '../../chapter/application/chapter-version.service';
import { WorldBibleService } from '../../world-bible/application/world-bible.service';
import { CharacterService } from '../../character/application/character.service';
import { PlotPlannerAgent } from '../plot-planner/plot-planner.agent';
import { ContextCompressorAgent } from '../context-compressor/context-compressor.agent';
import { ContentGeneratorAgent } from '../content-generator/content-generator.agent';
import { ContinuityCheckerAgent } from '../continuity-checker/continuity-checker.agent';
import { ChapterStatus } from '../../chapter/infrastructure/chapter.entity';
import { AgentStreamEvent, ChapterRunInput, ContinuityIssue, PlotPlan } from '../types';

/**
 * LangGraph state — annotations describe how each field is reduced when nodes
 * return partial updates. Defaults to last-writer-wins.
 */
const State = Annotation.Root({
  novelId: Annotation<string>(),
  chapterId: Annotation<string>(),
  ownerId: Annotation<string>(),
  extraInstructions: Annotation<string | undefined>(),
  contextSummary: Annotation<string>({ default: () => '', reducer: (_, x) => x }),
  plan: Annotation<PlotPlan | null>({ default: () => null, reducer: (_, x) => x }),
  draft: Annotation<string>({ default: () => '', reducer: (a, b) => (b ? a + b : a) }),
  issues: Annotation<ContinuityIssue[]>({ default: () => [], reducer: (_, x) => x }),
});
type GraphState = typeof State.State;

/**
 * Orchestrates the four agents into a directed graph:
 *   compress → plan → generate → continuity → persist
 * The graph is checkpointed in Postgres so a stalled run can be resumed
 * via the same `thread_id`.
 */
@Injectable()
export class ChapterOrchestrator {
  private readonly logger = new Logger(ChapterOrchestrator.name);
  private compiledGraph: ReturnType<typeof this.buildGraph>['compile'] extends (...args: unknown[]) => infer R
    ? R
    : never;

  constructor(
    @Inject(LANGGRAPH_CHECKPOINTER) private readonly checkpointer: BaseCheckpointSaver,
    private readonly cfg: ConfigService,
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
    private readonly versions: ChapterVersionService,
    private readonly bible: WorldBibleService,
    private readonly characters: CharacterService,
    private readonly planner: PlotPlannerAgent,
    private readonly compressor: ContextCompressorAgent,
    private readonly generator: ContentGeneratorAgent,
    private readonly continuity: ContinuityCheckerAgent,
  ) {
    this.compiledGraph = this.buildGraph().compile({ checkpointer: this.checkpointer });
  }

  /**
   * Streaming variant — yields events for the WebSocket gateway.
   * The generator agent's tokens are streamed directly; non-streaming nodes
   * emit phase markers so the client can show a progress UI.
   */
  async *streamChapter(
    input: ChapterRunInput,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent> {
    const ctx = await this.loadContext(input);

    // Phase 1: compress prior chapters.
    yield { type: 'phase', phase: 'compress' };
    const contextSummary = await this.compressor.compress({
      novelId: input.novelId,
      previousChapters: ctx.previous,
      ownerId: input.ownerId,
    });

    // Phase 2: plan beats.
    yield { type: 'phase', phase: 'plan' };
    const plan = await this.planner.plan({
      novel: ctx.novel,
      chapter: ctx.chapter,
      bible: ctx.bible,
      characters: ctx.characters,
      previousSummary: contextSummary,
      extraInstructions: input.extraInstructions,
      ownerId: input.ownerId,
    });

    await this.chapters.patchInternal(input.chapterId, {
      status: ChapterStatus.GENERATING,
      contextSummary,
      threadId: input.threadId ?? uuid(),
    });

    // Phase 3: stream prose tokens.
    yield { type: 'phase', phase: 'generate' };
    let draft = '';
    for await (const chunk of this.generator.streamChapter({
      novel: ctx.novel,
      chapter: ctx.chapter,
      plan,
      bible: ctx.bible,
      characters: ctx.characters,
      contextSummary,
      ownerId: input.ownerId,
      extraInstructions: input.extraInstructions,
      signal,
    })) {
      if (signal?.aborted) return;
      if (chunk.kind === 'reasoning') {
        yield { type: 'reasoning', value: chunk.value };
      } else {
        draft += chunk.value;
        yield { type: 'token', value: chunk.value };
      }
    }

    // Phase 4: continuity check.
    yield { type: 'phase', phase: 'continuity' };
    const rawFirst = await this.continuity.check({
      chapterContent: draft,
      bible: ctx.bible,
      characters: ctx.characters,
      contextSummary,
      ownerId: input.ownerId,
    });
    // 给每个 issue 打上稳定 id + status='active' + 出现时间戳
    const now = new Date().toISOString();
    let issues: ContinuityIssue[] = rawFirst.map((i) => ({
      ...i,
      id: uuid(),
      status: 'active',
      appearedAt: now,
    }));
    yield { type: 'continuity', payload: { issues } };

    // 拍第一份版本快照(无论后面是否会重写,这一稿都得留下来,可对比可回滚)
    await this.versions.snapshot({
      chapterId: input.chapterId,
      content: draft,
      contextSummary,
      continuityIssues: issues,
      reason: 'initial',
      note: `第一稿 · ${issues.length} 个 issue`,
    });

    // Phase 4.5: 循环修订 —— 只要还有 active/new 的 actionable issue,就再让 AI
    // 修一轮,直到 clean 或者达到 LLM_MAX_REWRITES 上限(默认 3)。
    // 单轮收益快速递减,3 轮通常足够;每轮代价 30~60s,封顶避免拖太久。
    // 任一轮失败立即 break,保留当前 draft 继续走 persist。
    const MAX_REWRITES = Number(this.cfg.get('LLM_MAX_REWRITES') ?? 3);
    let iter = 0;
    while (iter < MAX_REWRITES && !signal?.aborted) {
      // 仍未解决 + 非 info 级 = 这一轮要喂给 rewriteWithFixes 的 issues
      const unresolved = issues.filter(
        (i) => i.status !== 'resolved' && i.severity !== 'info',
      );
      if (unresolved.length === 0) break;

      iter++;
      this.logger.log(
        `continuity rewrite iter ${iter}/${MAX_REWRITES} · ${unresolved.length} unresolved issues`,
      );
      yield {
        type: 'phase',
        phase: 'rewrite',
        detail: `第 ${iter}/${MAX_REWRITES} 轮 · 修订 ${unresolved.length} 项`,
      };

      let rewritten: string;
      try {
        rewritten = await this.generator.rewriteWithFixes({
          novel: ctx.novel,
          chapter: ctx.chapter,
          bible: ctx.bible,
          characters: ctx.characters,
          originalDraft: draft,
          issues: unresolved,
          contextSummary,
          ownerId: input.ownerId,
          signal,
        });
      } catch (e) {
        this.logger.warn(
          `rewrite iter ${iter} failed (${(e as Error).message}), keeping previous draft`,
        );
        break;
      }

      // 再校验
      const rawNext = await this.continuity.check({
        chapterContent: rewritten,
        bible: ctx.bible,
        characters: ctx.characters,
        contextSummary,
        ownerId: input.ownerId,
      });

      // === 状态 diff ===
      // 同一条问题靠 message 文本 fuzzy-match;每轮都对所有"非 resolved"的
      // issue 重新判断:
      //   - 这轮检查里仍存在  → 保持当前 status (active 或 new 不变)
      //   - 这轮检查里消失了 → 标 resolved
      // rawNext 中本轮才出现的,所有历史 issue 都没见过的 message → 标 new
      const norm = (s: string) =>
        s.replace(/\s+/g, '').replace(/[。!?,!?,]/g, '').toLowerCase();
      const now = new Date().toISOString();
      const nextNormSet = new Set(rawNext.map((s) => norm(s.message)));
      const knownMessages = new Set(issues.map((i) => norm(i.message)));

      issues = issues.map((orig) => {
        if (orig.status === 'resolved') return orig;
        return nextNormSet.has(norm(orig.message))
          ? orig
          : ({ ...orig, status: 'resolved' as const, resolvedAt: now });
      });
      const trulyNew: ContinuityIssue[] = rawNext
        .filter((s) => !knownMessages.has(norm(s.message)))
        .map((s) => ({
          ...s,
          id: uuid(),
          status: 'new' as const,
          appearedAt: now,
        }));
      issues = [...issues, ...trulyNew];

      yield { type: 'replace', value: rewritten };
      yield { type: 'continuity', payload: { issues } };

      draft = rewritten;

      const resolvedNow = issues.filter((i) => i.status === 'resolved').length;
      const stillUnresolved = issues.filter(
        (i) => i.status !== 'resolved' && i.severity !== 'info',
      ).length;
      await this.versions.snapshot({
        chapterId: input.chapterId,
        content: rewritten,
        contextSummary,
        continuityIssues: issues,
        reason: 'continuity_fix',
        note:
          `自动修订第 ${iter} 轮 · 输入 ${unresolved.length} 项 · ` +
          `累计已解决 ${resolvedNow} 项 / 仍存在 ${stillUnresolved} 项 / 新增 ${trulyNew.length} 项`,
      });
      // while 条件下一轮自然会判断 stillUnresolved 是否 > 0,不需要在这里 break
    }

    // Phase 5: persist live chapter row.
    yield { type: 'phase', phase: 'persist' };
    await this.chapters.patchInternal(input.chapterId, {
      content: draft,
      status: ChapterStatus.DRAFT,
      continuityIssues: issues,
    });
  }

  /**
   * 给"新建章节"对话框打开时自动起一个标题用。
   * 用户已经填了大纲/想法时(outlineHint, extraHints),标题精准切中;
   * 否则基于上一章结尾推测本章核心事件。
   */
  async draftTitle(input: {
    novelId: string;
    ownerId: string;
    outlineHint?: string;
    extraHints?: string;
  }): Promise<{ title: string; chapterNumber: number }> {
    const novel = await this.novels.getOwned(input.novelId, input.ownerId);
    const [bible, characters, list] = await Promise.all([
      this.bible.findAllForNovel(input.novelId),
      this.characters.findAllForNovel(input.novelId),
      this.chapters.list(input.ownerId, input.novelId, { page: 1, pageSize: 200 }),
    ]);

    const allChapters = list.items;
    const nextChapterNumber =
      allChapters.reduce((m, c) => Math.max(m, c.chapterNumber), 0) + 1;
    const previousChapter =
      allChapters.find((c) => c.chapterNumber === nextChapterNumber - 1) ?? null;

    const res = await this.planner.draftTitle({
      novel,
      chapterNumber: nextChapterNumber,
      bible,
      characters,
      previousChapter,
      ownerId: input.ownerId,
      outlineHint: input.outlineHint,
      extraHints: input.extraHints,
    });
    return { ...res, chapterNumber: nextChapterNumber };
  }

  /**
   * Lightweight outline drafting for the create-chapter UX. The chapter
   * doesn't exist yet — caller passes the title the user just typed.
   * Pulls themes/world-bible/characters and a *cheap* digest of the last
   * 1~3 chapters (title + outline only — no LLM compression).
   */
  async draftOutline(input: {
    novelId: string;
    ownerId: string;
    title: string;
    hints?: string;
  }): Promise<{ outline: string; themesUsed: string[]; chapterNumber: number }> {
    const novel = await this.novels.getOwned(input.novelId, input.ownerId);
    const [bible, characters, list] = await Promise.all([
      this.bible.findAllForNovel(input.novelId),
      this.characters.findAllForNovel(input.novelId),
      this.chapters.list(input.ownerId, input.novelId, { page: 1, pageSize: 200 }),
    ]);

    const allChapters = list.items;
    const nextChapterNumber =
      allChapters.reduce((m, c) => Math.max(m, c.chapterNumber), 0) + 1;

    // 上一章 + 上上章的正文 *末尾* 各 ~2000 字。
    //  - 优先 content(真实发生的剧情),fallback 才用 outline
    //  - 取末尾而不是开头:章末的钩子 / 悬念 是接下一章最重要的信息
    //  - 再往前的章节(第 3 往上)就只取 title + outline 简介,避免 prompt 爆
    const sorted = [...allChapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
    const recent = sorted.slice(-2);
    const olderSummaries = sorted.slice(0, -2).slice(-5); // 最多再带 5 章的标题/大纲

    const recentDigest = recent
      .map((c) => {
        const body = (c.content ?? '').trim() || (c.outline ?? '').trim() || '';
        if (!body) return `# 第 ${c.chapterNumber} 章《${c.title}》(暂无内容)`;
        // 章末优先(钩子/悬念在这里)
        const tail = body.length > 2000 ? '…(前略)…\n' + body.slice(-2000) : body;
        return `# 第 ${c.chapterNumber} 章《${c.title}》\n${tail}`;
      })
      .join('\n\n');

    const olderDigest = olderSummaries
      .map(
        (c) =>
          `- 第 ${c.chapterNumber} 章《${c.title}》:` +
          ` ${(c.outline ?? c.content ?? '').slice(0, 160).replace(/\s+/g, ' ')}`,
      )
      .join('\n');

    const previousDigest = [
      olderDigest ? `## 更早章节速览\n${olderDigest}` : '',
      recentDigest ? `## 最近 ${recent.length} 章详情\n${recentDigest}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const res = await this.planner.draftOutline({
      novel,
      title: input.title,
      chapterNumber: nextChapterNumber,
      bible,
      characters,
      previousDigest,
      hints: input.hints,
      ownerId: input.ownerId,
    });

    return { ...res, chapterNumber: nextChapterNumber };
  }

  /**
   * Non-streaming, fully checkpointed run via LangGraph. Use this for
   * resumable / replayable jobs (e.g. retried by a worker).
   */
  async runChapter(input: ChapterRunInput) {
    const threadId = input.threadId ?? uuid();
    const config = { configurable: { thread_id: threadId } };

    const initial: GraphState = {
      novelId: input.novelId,
      chapterId: input.chapterId,
      ownerId: input.ownerId,
      extraInstructions: input.extraInstructions,
      contextSummary: '',
      plan: null,
      draft: '',
      issues: [],
    };

    const final = await this.compiledGraph.invoke(initial, config);
    return {
      threadId,
      chapterId: input.chapterId,
      issueCount: final.issues.length,
      wordCount: final.draft.length,
    };
  }

  private buildGraph() {
    return new StateGraph(State)
      .addNode('compress', async (s: GraphState) => {
        const ctx = await this.loadContext({
          novelId: s.novelId,
          chapterId: s.chapterId,
          ownerId: s.ownerId,
        });
        const summary = await this.compressor.compress({
          novelId: s.novelId,
          previousChapters: ctx.previous,
          ownerId: s.ownerId,
        });
        return { contextSummary: summary };
      })
      .addNode('planner', async (s: GraphState) => {
        const ctx = await this.loadContext({
          novelId: s.novelId,
          chapterId: s.chapterId,
          ownerId: s.ownerId,
        });
        const plan = await this.planner.plan({
          novel: ctx.novel,
          chapter: ctx.chapter,
          bible: ctx.bible,
          characters: ctx.characters,
          previousSummary: s.contextSummary,
          extraInstructions: s.extraInstructions,
          ownerId: s.ownerId,
        });
        return { plan };
      })
      .addNode('generate', async (s: GraphState) => {
        const ctx = await this.loadContext({
          novelId: s.novelId,
          chapterId: s.chapterId,
          ownerId: s.ownerId,
        });
        if (!s.plan) throw new Error('plan missing — graph order broken');
        let draft = '';
        for await (const tok of this.generator.streamChapter({
          novel: ctx.novel,
          chapter: ctx.chapter,
          plan: s.plan,
          bible: ctx.bible,
          characters: ctx.characters,
          contextSummary: s.contextSummary,
          ownerId: s.ownerId,
          extraInstructions: s.extraInstructions,
        })) {
          draft += tok;
        }
        return { draft };
      })
      .addNode('continuity', async (s: GraphState) => {
        const ctx = await this.loadContext({
          novelId: s.novelId,
          chapterId: s.chapterId,
          ownerId: s.ownerId,
        });
        const issues = await this.continuity.check({
          chapterContent: s.draft,
          bible: ctx.bible,
          characters: ctx.characters,
          contextSummary: s.contextSummary,
          ownerId: s.ownerId,
        });
        return { issues };
      })
      .addNode('persist', async (s: GraphState) => {
        await this.chapters.patchInternal(s.chapterId, {
          content: s.draft,
          contextSummary: s.contextSummary,
          status: ChapterStatus.DRAFT,
          continuityIssues: s.issues,
        });
        return {};
      })
      .addEdge(START, 'compress')
      .addEdge('compress', 'planner')
      .addEdge('planner', 'generate')
      .addEdge('generate', 'continuity')
      .addEdge('continuity', 'persist')
      .addEdge('persist', END);
  }

  private async loadContext(input: { novelId: string; chapterId: string; ownerId: string }) {
    const novel = await this.novels.getOwned(input.novelId, input.ownerId);
    const chapter = await this.chapters.getOwned(input.ownerId, input.novelId, input.chapterId);
    const [bible, characters, previous] = await Promise.all([
      this.bible.findAllForNovel(input.novelId),
      this.characters.findAllForNovel(input.novelId),
      this.chapters.findPrevious(input.novelId, chapter.chapterNumber),
    ]);
    return { novel, chapter, bible, characters, previous };
  }
}
