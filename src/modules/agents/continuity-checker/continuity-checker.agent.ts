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
          'You are a strict continuity editor. Detect contradictions between the chapter and the established world bible / character profiles / prior context. Only report real contradictions, not stylistic notes.',
        userTemplate: `WORLD BIBLE:
{bibleDigest}

CHARACTERS:
{characterDigest}

PRIOR CONTEXT: {contextSummary}

CHAPTER UNDER REVIEW:
<<<
{chapterContent}
>>>

Return a JSON array of issues. Each item: {"severity":"info|warning|error","message":"...","suggestion":"...","characterId":"<uuid-or-omit>"}.
Empty array means no issues.`,
      } as unknown as Awaited<ReturnType<PromptTemplateService['resolveActive']>>;
    }
  }
}
