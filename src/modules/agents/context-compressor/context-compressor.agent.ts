import { Inject, Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../infrastructure/llm/llm.service';
import { PromptTemplateService } from '../../prompt-template/application/prompt-template.service';
import { PromptScope } from '../../prompt-template/infrastructure/prompt-template.entity';
import { ChapterEntity } from '../../chapter/infrastructure/chapter.entity';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import type Redis from 'ioredis';
import { createHash } from 'crypto';

const CACHE_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

@Injectable()
export class ContextCompressorAgent {
  private readonly logger = new Logger(ContextCompressorAgent.name);

  constructor(
    private readonly llm: LlmService,
    private readonly tpls: PromptTemplateService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Produce a single rolling summary that captures plot, character state,
   * and unresolved threads from previous chapters. Cached in Redis keyed
   * by the hash of the chapter list to avoid recomputation.
   */
  async compress(input: {
    novelId: string;
    previousChapters: ChapterEntity[];
    ownerId: string;
    targetTokens?: number;
  }): Promise<string> {
    if (input.previousChapters.length === 0) return '';

    const cacheKey = this.cacheKey(input.novelId, input.previousChapters);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`compress cache hit ${cacheKey}`);
      return cached;
    }

    const tpl = await this.safeResolve(input.ownerId);
    const target = input.targetTokens ?? 800;

    // Two-tier compression: keep the most recent 2 chapters in detail,
    // older ones get squashed into prior contextSummary if present.
    const recent = input.previousChapters.slice(-2);
    const ancient = input.previousChapters.slice(0, -2);

    const ancientDigest =
      ancient.length === 0
        ? ''
        : ancient
            .map(
              (c) =>
                `# Chapter ${c.chapterNumber}: ${c.title}\nSummary: ${
                  c.contextSummary?.slice(0, 600) ?? c.content?.slice(0, 600) ?? ''
                }`,
            )
            .join('\n\n');

    const recentDigest = recent
      .map(
        (c) =>
          `# Chapter ${c.chapterNumber}: ${c.title}\n${(c.content ?? c.outline ?? '').slice(0, 4000)}`,
      )
      .join('\n\n');

    const user = PromptTemplateService.render(tpl.userTemplate, {
      ancientDigest,
      recentDigest,
      targetTokens: target,
    });

    const summary = (await this.llm.complete(tpl.systemPrompt, user, { temperature: 0.2 })).trim();
    await this.redis.set(cacheKey, summary, 'EX', CACHE_TTL_SEC);
    return summary;
  }

  private cacheKey(novelId: string, chapters: ChapterEntity[]): string {
    const sig = chapters
      .map((c) => `${c.id}:${c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt}`)
      .join('|');
    const hash = createHash('sha1').update(sig).digest('hex');
    return `compress:${novelId}:${hash}`;
  }

  private async safeResolve(ownerId: string) {
    try {
      return await this.tpls.resolveActive(PromptScope.CONTEXT_COMPRESSOR, ownerId);
    } catch {
      return {
        systemPrompt:
          'You are a story memory compressor. Distill the past chapters into a tight summary that preserves plot causality, character states, world facts, and unresolved threads. Be concise.',
        userTemplate: `<ancient_chapters>
{ancientDigest}
</ancient_chapters>

<recent_chapters>
{recentDigest}
</recent_chapters>

Produce a single rolling summary, target ~{targetTokens} tokens.
Sections:
1. PLOT SO FAR (causal chain)
2. CHARACTER STATES (name → arc state, location, mood)
3. WORLD FACTS established
4. OPEN THREADS / promises to the reader
Use bullet points where useful.`,
      } as unknown as Awaited<ReturnType<PromptTemplateService['resolveActive']>>;
    }
  }
}
