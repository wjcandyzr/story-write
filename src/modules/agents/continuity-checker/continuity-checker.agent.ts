import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../infrastructure/llm/llm.service';
import { PromptTemplateService } from '../../prompt-template/application/prompt-template.service';
import { PromptScope } from '../../prompt-template/infrastructure/prompt-template.entity';
import { WorldBibleEntry } from '../../world-bible/infrastructure/world-bible.entity';
import { CharacterEntity } from '../../character/infrastructure/character.entity';
import { ContinuityIssue } from '../types';

@Injectable()
export class ContinuityCheckerAgent {
  private readonly logger = new Logger(ContinuityCheckerAgent.name);

  constructor(private readonly llm: LlmService, private readonly tpls: PromptTemplateService) {}

  async check(input: {
    chapterContent: string;
    bible: WorldBibleEntry[];
    characters: CharacterEntity[];
    contextSummary: string;
    ownerId: string;
  }): Promise<ContinuityIssue[]> {
    const tpl = await this.safeResolve(input.ownerId);

    const user = PromptTemplateService.render(tpl.userTemplate, {
      bibleDigest: input.bible
        .map((b) => `[${b.category}|imp=${b.importance}] ${b.title}: ${b.content.slice(0, 240)}`)
        .join('\n'),
      characterDigest: input.characters
        .map(
          (c) =>
            `${c.name} (${c.roleType}) personality=${c.personality ?? ''} goal=${c.goal ?? ''} arc=${JSON.stringify(c.arcState ?? {})}`,
        )
        .join('\n'),
      contextSummary: input.contextSummary || '(none)',
      chapterContent: input.chapterContent.slice(0, 16000),
    });

    const raw = await this.llm.complete(tpl.systemPrompt, user, { temperature: 0.0 });
    return this.parseIssues(raw);
  }

  private parseIssues(raw: string): ContinuityIssue[] {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x: unknown): x is { severity: string; message: string } => {
          if (typeof x !== 'object' || x === null) return false;
          const obj = x as Record<string, unknown>;
          return typeof obj.severity === 'string' && typeof obj.message === 'string';
        })
        .map((x) => ({
          severity: ['info', 'warning', 'error'].includes(x.severity)
            ? (x.severity as ContinuityIssue['severity'])
            : 'warning',
          message: x.message,
          suggestion: (x as { suggestion?: string }).suggestion,
          characterId: (x as { characterId?: string }).characterId,
        }));
    } catch (e) {
      this.logger.warn(`continuity parse failed: ${(e as Error).message}`);
      return [];
    }
  }

  private async safeResolve(ownerId: string) {
    try {
      return await this.tpls.resolveActive(PromptScope.CONTINUITY_CHECKER, ownerId);
    } catch {
      return {
        systemPrompt:
          '你是一个严格的中文小说连续性审稿人。检测本章与已建立的世界圣经 / 角色档案 / 前情提要之间的矛盾。' +
          '只报告真正的事实矛盾,不要报告风格、节奏、措辞偏好。' +
          '严格遵守下面的 severity 分级标准 —— 这是后续是否触发自动修订的依据。',
        userTemplate: `# 世界圣经
{bibleDigest}

# 角色档案
{characterDigest}

# 前情提要
{contextSummary}

# 本章正文
<<<
{chapterContent}
>>>

# severity 分级标准(必须严格遵守)

**error** — 直接矛盾已建立的事实,继续保留会让读者觉得 BUG:
- 角色拥有从未在世界圣经/前情中提过的能力(例:主角突然会御剑,但前文从未说过他会修仙)
- 物品违反魔法体系/科学规则(例:无法解封的禁器在本章被随意打开)
- 时间/空间矛盾(例:角色同一时刻出现在两个地点)
- 人物属性矛盾(例:档案说主角左眉断口,本章描写右眉)
- 已死亡 / 已销毁的人事物再次出现且没有解释

**warning** — 不直接矛盾,但缺乏前文铺垫,有"凭空冒出"嫌疑:
- 突然出现一个未介绍过的角色/地点/物品,且本章没有交代来历
- 角色行为与其性格描述明显不符,且没有触发因素
- 提到一个新概念/规则,与世界观风格不符但不绝对矛盾

**info** — 只是改进建议,事实层面没问题:
- "可以加一句外貌描写让画面更具体"
- "节奏偏快,中段可以铺垫"
- 这类建议无须自动修订,只供作者参考

# 输出格式
返回一个 JSON 数组。每项格式:
{"severity": "info|warning|error", "message": "矛盾点的简短描述", "suggestion": "如何修正,具体到可执行", "characterId": "<相关角色的uuid,可省略>"}

如果完全没问题,返回空数组 []。
不要在 JSON 之外添加任何解释。`,
      } as unknown as Awaited<ReturnType<PromptTemplateService['resolveActive']>>;
    }
  }
}
