import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../infrastructure/llm/llm.service';
import { PromptTemplateService } from '../../prompt-template/application/prompt-template.service';
import { PromptScope } from '../../prompt-template/infrastructure/prompt-template.entity';
import { CharacterEntity } from '../../character/infrastructure/character.entity';
import { WorldBibleEntry } from '../../world-bible/infrastructure/world-bible.entity';
import { ChapterEntity } from '../../chapter/infrastructure/chapter.entity';
import { NovelEntity } from '../../novel/infrastructure/novel.entity';
import { PlotPlan } from '../types';

@Injectable()
export class ContentGeneratorAgent {
  private readonly logger = new Logger(ContentGeneratorAgent.name);

  constructor(private readonly llm: LlmService, private readonly tpls: PromptTemplateService) {}

  async *streamChapter(input: {
    novel: NovelEntity;
    chapter: ChapterEntity;
    plan: PlotPlan;
    bible: WorldBibleEntry[];
    characters: CharacterEntity[];
    contextSummary: string;
    ownerId: string;
    extraInstructions?: string;
    signal?: AbortSignal;
  }): AsyncGenerator<string> {
    const tpl = await this.safeResolve(input.ownerId);

    const user = PromptTemplateService.render(tpl.userTemplate, {
      novelTitle: input.novel.title,
      chapterTitle: input.chapter.title,
      chapterNumber: input.chapter.chapterNumber,
      planJson: JSON.stringify(input.plan, null, 2),
      bibleDigest: input.bible
        .filter((b) => b.importance >= 7)
        .map((b) => `[${b.category}] ${b.title}: ${b.content.slice(0, 300)}`)
        .join('\n'),
      characterDigest: input.characters
        .map((c) => `${c.name} (${c.roleType}): ${c.personality ?? ''} | goal=${c.goal ?? ''}`)
        .join('\n'),
      contextSummary: input.contextSummary || '(none)',
      extraInstructions: input.extraInstructions ?? '',
    });

    // 透传 signal:LlmService 内部会用它去 abort 真正的上游 HTTP 请求,
    // 而不只是停止前端迭代 —— 否则 LLM 在云端继续烧 token。
    for await (const tok of this.llm.stream(tpl.systemPrompt, user, {
      temperature: 0.85,
      signal: input.signal,
    })) {
      if (input.signal?.aborted) {
        this.logger.warn('content stream aborted by caller');
        return;
      }
      yield tok;
    }
  }

  private async safeResolve(ownerId: string) {
    try {
      return await this.tpls.resolveActive(PromptScope.CONTENT_GENERATOR, ownerId);
    } catch {
      return {
        systemPrompt:
          'You are a master Chinese-language web-novel author. Write vivid, paced prose with strong character voice. Honor the world bible exactly. Avoid summarizing — show, don\'t tell.',
        userTemplate: `Novel: {novelTitle}
Chapter {chapterNumber}: {chapterTitle}

PLAN (must be followed beat by beat):
{planJson}

WORLD FACTS (must not contradict):
{bibleDigest}

CHARACTERS:
{characterDigest}

CONTEXT SO FAR: {contextSummary}

Author note: {extraInstructions}

Write the full chapter prose now. Use multiple scenes, dialogue, and sensory detail. End with the planned cliffhanger.`,
      } as unknown as Awaited<ReturnType<PromptTemplateService['resolveActive']>>;
    }
  }
}
