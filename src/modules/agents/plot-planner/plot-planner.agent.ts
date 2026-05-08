import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../infrastructure/llm/llm.service';
import { PromptTemplateService } from '../../prompt-template/application/prompt-template.service';
import { PromptScope } from '../../prompt-template/infrastructure/prompt-template.entity';
import { WorldBibleEntry } from '../../world-bible/infrastructure/world-bible.entity';
import { CharacterEntity } from '../../character/infrastructure/character.entity';
import { ChapterEntity } from '../../chapter/infrastructure/chapter.entity';
import { NovelEntity } from '../../novel/infrastructure/novel.entity';
import { PlotPlan } from '../types';

@Injectable()
export class PlotPlannerAgent {
  private readonly logger = new Logger(PlotPlannerAgent.name);

  constructor(private readonly llm: LlmService, private readonly tpls: PromptTemplateService) {}

  async plan(input: {
    novel: NovelEntity;
    chapter: ChapterEntity;
    bible: WorldBibleEntry[];
    characters: CharacterEntity[];
    previousSummary: string;
    extraInstructions?: string;
    ownerId: string;
  }): Promise<PlotPlan> {
    const tpl = await this.safeResolve(PromptScope.PLOT_PLANNER, input.ownerId, defaultPlanner);

    const vars = {
      novelTitle: input.novel.title,
      novelSynopsis: input.novel.synopsis ?? '',
      chapterNumber: input.chapter.chapterNumber,
      chapterTitle: input.chapter.title,
      outline: input.chapter.outline ?? '(none yet — invent one)',
      previousSummary: input.previousSummary || '(this is the first chapter)',
      bibleDigest: input.bible
        .slice(0, 30)
        .map((b) => `- [${b.category}] ${b.title}: ${b.content.slice(0, 240)}`)
        .join('\n'),
      characterDigest: input.characters
        .map(
          (c) =>
            `- ${c.name} (${c.roleType}) goal=${c.goal ?? 'n/a'} arc=${JSON.stringify(c.arcState ?? {})}`,
        )
        .join('\n'),
      extraInstructions: input.extraInstructions ?? '',
    };

    const user = PromptTemplateService.render(tpl.userTemplate, vars);
    const raw = await this.llm.complete(tpl.systemPrompt, user, { temperature: 0.4 });

    return this.parsePlan(raw);
  }

  private async safeResolve(scope: PromptScope, ownerId: string, fallback: { system: string; user: string }) {
    try {
      return await this.tpls.resolveActive(scope, ownerId);
    } catch {
      this.logger.warn(`No template for ${scope}, using built-in default`);
      return {
        systemPrompt: fallback.system,
        userTemplate: fallback.user,
      } as unknown as Awaited<ReturnType<PromptTemplateService['resolveActive']>>;
    }
  }

  private parsePlan(raw: string): PlotPlan {
    // Try strict JSON first; fall back to a permissive bracket extraction.
    const json = extractJson(raw);
    if (json) {
      try {
        const obj = JSON.parse(json);
        return {
          beats: Array.isArray(obj.beats) ? obj.beats : [],
          hook: typeof obj.hook === 'string' ? obj.hook : '',
          cliffhanger: typeof obj.cliffhanger === 'string' ? obj.cliffhanger : '',
        };
      } catch (e) {
        this.logger.warn(`PlotPlan JSON parse failed: ${(e as Error).message}`);
      }
    }
    return { beats: [{ title: 'unstructured', summary: raw.slice(0, 600) }], hook: '', cliffhanger: '' };
  }
}

function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

const defaultPlanner = {
  system:
    'You are a master story architect for long-form Chinese web novels. Plan the next chapter in JSON.',
  user: `Novel: {novelTitle}
Synopsis: {novelSynopsis}

WORLD BIBLE (high importance only):
{bibleDigest}

CHARACTERS:
{characterDigest}

PREVIOUS STORY (compressed): {previousSummary}

CURRENT CHAPTER #{chapterNumber} — {chapterTitle}
Existing outline: {outline}
Author note: {extraInstructions}

Return STRICT JSON of the form:
{
  "beats": [{"title": "...", "summary": "..."}, ...],
  "hook": "first-paragraph hook",
  "cliffhanger": "final-paragraph cliffhanger"
}`,
};
