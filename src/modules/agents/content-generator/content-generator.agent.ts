import { Injectable, Logger } from '@nestjs/common';
import { LlmService, type LlmStreamChunk } from '../../../infrastructure/llm/llm.service';
import { PromptTemplateService } from '../../prompt-template/application/prompt-template.service';
import { PromptScope } from '../../prompt-template/infrastructure/prompt-template.entity';
import { CharacterEntity } from '../../character/infrastructure/character.entity';
import { WorldBibleEntry } from '../../world-bible/infrastructure/world-bible.entity';
import { ChapterEntity } from '../../chapter/infrastructure/chapter.entity';
import { NovelEntity } from '../../novel/infrastructure/novel.entity';
import { ContinuityIssue, PlotPlan } from '../types';

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
  }): AsyncGenerator<LlmStreamChunk> {
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

    // 透传 signal + chunk 类型(content / reasoning)
    for await (const chunk of this.llm.stream(tpl.systemPrompt, user, {
      temperature: 0.85,
      signal: input.signal,
    })) {
      if (input.signal?.aborted) {
        this.logger.warn('content stream aborted by caller');
        return;
      }
      yield chunk;
    }
  }

  /**
   * 拿到原始草稿和连续性检查发现的问题,让 LLM 重写一版,
   * 要求只修复指出的具体矛盾,**不要**重写其他部分。返回一段完整文本(非流式)。
   *
   * 设计原则:
   * - 系统 prompt 强调"最小手术":能改一句话解决就别改一段
   * - 提供"必须保留"清单(角色名 / 时间 / 场景 / 关键道具)
   * - 仅处理 severity=error 和 warning,info 不进 prompt
   */
  async rewriteWithFixes(input: {
    novel: NovelEntity;
    chapter: ChapterEntity;
    bible: WorldBibleEntry[];
    characters: CharacterEntity[];
    originalDraft: string;
    issues: ContinuityIssue[];
    contextSummary: string;
    ownerId: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const actionable = input.issues.filter((i) => i.severity !== 'info');
    if (actionable.length === 0) return input.originalDraft;

    const issuesDigest = actionable
      .map(
        (i, idx) =>
          `${idx + 1}. [${i.severity}] ${i.message}` +
          (i.suggestion ? `\n   修订建议: ${i.suggestion}` : ''),
      )
      .join('\n\n');

    const system =
      '你是中文小说的资深编辑。读者发现了下面这一章里的连续性 / 设定矛盾,' +
      '你的任务是**最小化修改**原文,只改有问题的地方,其他段落保留原样。' +
      '不要重写整章。不要改文风。不要扩写或缩写。改完直接给完整章节正文,不要解释。';

    const user = `# 小说: 《${input.novel.title}》
# 第 ${input.chapter.chapterNumber} 章 · ${input.chapter.title}

# 必须不变的设定(违反就是 bug)
${input.bible
  .filter((b) => b.importance >= 7)
  .map((b) => `- [${b.category}] ${b.title}: ${b.content.slice(0, 240)}`)
  .join('\n') || '(无)'}

# 角色一致性(违反就是 bug)
${input.characters
  .map(
    (c) =>
      `- ${c.name}(${c.roleType}) 性格: ${c.personality ?? ''} | 目标: ${c.goal ?? ''}`,
  )
  .join('\n') || '(无)'}

# 前情提要
${input.contextSummary || '(无)'}

# 编辑发现的问题
${issuesDigest}

# 原稿(请最小化修改后整章重出)
<<<
${input.originalDraft}
>>>

请输出修订后的完整章节正文,不要任何前后缀说明。`;

    const text = await this.llm.complete(system, user, {
      temperature: 0.5,
      signal: input.signal,
    });
    return text;
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
