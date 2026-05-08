import { Inject, Injectable, Logger } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { v4 as uuid } from 'uuid';
import { LANGGRAPH_CHECKPOINTER } from '../../../infrastructure/checkpoint/checkpoint.module';
import { NovelService } from '../../novel/application/novel.service';
import { ChapterService } from '../../chapter/application/chapter.service';
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
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
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
    for await (const tok of this.generator.streamChapter({
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
      draft += tok;
      yield { type: 'token', value: tok };
    }

    // Phase 4: continuity check.
    yield { type: 'phase', phase: 'continuity' };
    const issues = await this.continuity.check({
      chapterContent: draft,
      bible: ctx.bible,
      characters: ctx.characters,
      contextSummary,
      ownerId: input.ownerId,
    });
    yield { type: 'continuity', payload: { issues } };

    // Phase 5: persist.
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

    const previousDigest =
      allChapters
        .slice(-3)
        .map(
          (c) =>
            `第 ${c.chapterNumber} 章《${c.title}》: ${
              c.outline?.slice(0, 200) ?? c.content?.slice(0, 200) ?? '(空)'
            }`,
        )
        .join('\n') || '';

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
