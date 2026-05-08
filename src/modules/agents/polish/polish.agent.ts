import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../infrastructure/llm/llm.service';
import { PromptTemplateService } from '../../prompt-template/application/prompt-template.service';
import { PromptScope } from '../../prompt-template/infrastructure/prompt-template.entity';
import { NovelService } from '../../novel/application/novel.service';
import { WorldBibleService } from '../../world-bible/application/world-bible.service';

export enum PolishContextType {
  THEME = 'theme',                    // 主题描述
  WORLD_BIBLE = 'world_bible',        // 世界观条目
  CHARACTER_BG = 'character_background', // 角色背景
  OUTLINE = 'outline',                // 章节大纲
  GENERAL = 'general',                // 通用文本
}

export interface PolishInput {
  text: string;
  contextType: PolishContextType;
  ownerId: string;
  /** 可选 — 提供时会注入小说世界观作为上下文,让润色更贴合设定 */
  novelId?: string;
  /** 用户额外指示,例如 "更悬疑"、"压缩到 200 字以内" */
  extraInstructions?: string;
  /** 上下文相关的轻量提示,例如主题名 / 角色名 / tags */
  hints?: { name?: string; tags?: string[]; [k: string]: unknown };
}

export interface PolishResult {
  original: string;
  polished: string;
  contextType: PolishContextType;
  /** LLM 在 polish 之外给出的简短解释,可选 */
  notes?: string;
}

const TYPE_HINT: Record<PolishContextType, string> = {
  [PolishContextType.THEME]:
    '这是一段小说的主题/题材设定描述,要求:鲜明、独特、有钩子,能让读者一眼看出小说的卖点。',
  [PolishContextType.WORLD_BIBLE]:
    '这是世界观设定条目,要求:逻辑自洽、信息密度高、避免空话,保留所有具体的名词。',
  [PolishContextType.CHARACTER_BG]:
    '这是角色背景设定,要求:让人物动机清晰、伤痕具体、欲望明确,避免成为脸谱化模板。',
  [PolishContextType.OUTLINE]:
    '这是章节大纲,要求:节奏紧凑、有钩子有悬念,beats 清晰,避免流水账。',
  [PolishContextType.GENERAL]:
    '这是一段中文文本,要求:语言流畅、节奏感好,但保留原意和所有具体信息。',
};

@Injectable()
export class PolishAgent {
  private readonly logger = new Logger(PolishAgent.name);

  constructor(
    private readonly llm: LlmService,
    private readonly tpls: PromptTemplateService,
    private readonly novels: NovelService,
    private readonly bible: WorldBibleService,
  ) {}

  async polish(input: PolishInput): Promise<PolishResult> {
    const tpl = await this.safeResolve(input.ownerId);

    // 可选地拉一些世界观作为锚点,让 polish 不偏离设定
    let novelDigest = '';
    let bibleDigest = '';
    if (input.novelId) {
      try {
        const novel = await this.novels.getOwned(input.novelId, input.ownerId);
        novelDigest = `小说《${novel.title}》 / ${novel.synopsis ?? ''}`;
        const entries = await this.bible.findAllForNovel(input.novelId);
        bibleDigest = entries
          .filter((e) => e.importance >= 7)
          .slice(0, 8)
          .map((e) => `- [${e.category}] ${e.title}: ${e.content.slice(0, 160)}`)
          .join('\n');
      } catch (e) {
        this.logger.warn(`could not load novel context: ${(e as Error).message}`);
      }
    }

    const user = PromptTemplateService.render(tpl.userTemplate, {
      typeHint: TYPE_HINT[input.contextType],
      hintName: input.hints?.name ?? '',
      hintTags: (input.hints?.tags ?? []).join(', '),
      novelDigest,
      bibleDigest,
      extraInstructions: input.extraInstructions ?? '',
      original: input.text,
    });

    const raw = await this.llm.complete(tpl.systemPrompt, user, { temperature: 0.6 });
    const { polished, notes } = this.splitPolishedAndNotes(raw);

    return {
      original: input.text,
      polished,
      contextType: input.contextType,
      notes,
    };
  }

  /**
   * LLM 通常会在润色文本之外多嘴几句解释。我们用一个简单约定:
   * 真正的润色文本在 <polished>...</polished> 之间,可选地配 <notes>...</notes>。
   * 找不到 tag 时整段当 polished 返回。
   */
  private splitPolishedAndNotes(raw: string): { polished: string; notes?: string } {
    const polishedMatch = raw.match(/<polished>([\s\S]*?)<\/polished>/i);
    const notesMatch = raw.match(/<notes>([\s\S]*?)<\/notes>/i);
    if (polishedMatch) {
      return {
        polished: polishedMatch[1].trim(),
        notes: notesMatch ? notesMatch[1].trim() : undefined,
      };
    }
    return { polished: raw.trim() };
  }

  private async safeResolve(ownerId: string) {
    try {
      return await this.tpls.resolveActive(PromptScope.POLISH, ownerId);
    } catch {
      return {
        systemPrompt:
          '你是顶级中文小说编辑,擅长在保留原意的前提下,把粗糙文本润色成专业出版水准。' +
          '只调整表达和节奏,不擅自添加新信息;不删除原文已有的具体名词、数字、人名、设定。' +
          '输出严格遵守格式要求。',
        userTemplate: `# 润色任务

## 文本类型
{typeHint}

## 上下文(供参考,不要写进润色结果)
- 主题/角色名: {hintName}
- 标签: {hintTags}
- 所属小说: {novelDigest}
- 关键世界观:
{bibleDigest}

## 用户额外要求
{extraInstructions}

## 待润色原文
<<<
{original}
>>>

## 输出格式(严格遵守)
<polished>
润色后的最终文本,直接是用户可以复制粘贴的那一段。
</polished>
<notes>
1~3 句话说明你做了哪些主要修改,以及为什么。
</notes>`,
      } as unknown as Awaited<ReturnType<PromptTemplateService['resolveActive']>>;
    }
  }
}
