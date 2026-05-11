import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmService } from '../../../infrastructure/llm/llm.service';
import { PromptTemplateService } from '../../prompt-template/application/prompt-template.service';
import { PromptScope } from '../../prompt-template/infrastructure/prompt-template.entity';
import { WorldBibleEntry } from '../../world-bible/infrastructure/world-bible.entity';
import { CharacterEntity } from '../../character/infrastructure/character.entity';
import { ChapterEntity } from '../../chapter/infrastructure/chapter.entity';
import { NovelEntity } from '../../novel/infrastructure/novel.entity';
import { ThemeEntity } from '../../theme/infrastructure/theme.entity';
import { PlotPlan } from '../types';

@Injectable()
export class PlotPlannerAgent {
  private readonly logger = new Logger(PlotPlannerAgent.name);

  constructor(
    private readonly llm: LlmService,
    private readonly tpls: PromptTemplateService,
    // Direct repo injection avoids a circular module dependency with ThemeModule
    // (ThemeModule already imports AgentsModule for PolishAgent).
    @InjectRepository(ThemeEntity) private readonly themeRepo: Repository<ThemeEntity>,
  ) {}

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

  /**
   * UX-facing outline draft: given a chapter title the user just typed,
   * synthesize a 3–6 句话 free-text outline they can edit. Pulls in themes,
   * world bible, characters, and a lightweight digest of recent chapters
   * (titles + outlines) — no expensive compression pass required.
   */
  async draftOutline(input: {
    novel: NovelEntity;
    title: string;
    chapterNumber: number;
    bible: WorldBibleEntry[];
    characters: CharacterEntity[];
    /** brief title+outline digest of the previous 1~3 chapters */
    previousDigest: string;
    ownerId: string;
    hints?: string;
  }): Promise<{ outline: string; themesUsed: string[] }> {
    const themes = await this.themeRepo.find({
      where: { novelId: input.novel.id },
      order: { priority: 'DESC' },
    });
    const usedThemes = themes.filter((t) => t.priority >= 5).slice(0, 5);
    const themeDigest =
      usedThemes
        .map((t) => {
          const tag = t.tags?.length ? ` [${t.tags.join('/')}]` : '';
          const desc = (t.description ?? '').slice(0, 240);
          return `- 【${t.name}】${tag}\n  ${desc}`;
        })
        .join('\n') || '(暂无主题)';

    const system =
      '你是中文长篇小说的剧情顾问。读者刚定下了某一章的标题,希望你基于已有的主题、世界观、角色、**特别是上一章末尾发生的事**,给出一段 3~6 句的章节大纲,作为他们后续创作的起点。要求:' +
      '\n1. 必须呼应用户填的标题,不要另起炉灶。' +
      '\n2. **必须直接接上一章结尾的钩子** —— 上一章谁说了什么、谁去了哪里、出现了什么悬念,本章一开始就要回应,不能跳跃。' +
      '\n3. 必须用到至少一项主题或世界观锚点;不要写成放之四海皆准的通用大纲。' +
      '\n4. 推进剧情,不要只是描写场景。结尾留一个钩子,引向下一章。' +
      '\n5. 直接给大纲文字,不要解释,不要列点,不要 markdown 标题。' +
      '\n6. 如果前情中**完全没有上一章**(第一章),才允许自由起开篇。';

    const userTpl = `# 小说
《{novelTitle}》— {novelSynopsis}

# 主题(用户已定义,需要呼应)
{themeDigest}

# 关键世界观
{bibleDigest}

# 主要角色
{characterDigest}

# 前情提要(**最重要,务必通读上一章末尾,看主角现在的状态和悬念**)
{previousDigest}

# 要写的章节
第 {chapterNumber} 章 · {chapterTitle}
{hints}

请直接产出大纲文字。`;

    const user = PromptTemplateService.render(userTpl, {
      novelTitle: input.novel.title,
      novelSynopsis: input.novel.synopsis ?? '(无简介)',
      themeDigest,
      bibleDigest:
        input.bible
          .filter((b) => b.importance >= 6)
          .slice(0, 8)
          .map((b) => `- [${b.category}] ${b.title}: ${b.content.slice(0, 160)}`)
          .join('\n') || '(暂无)',
      characterDigest:
        input.characters
          .slice(0, 8)
          .map(
            (c) =>
              `- ${c.name}(${c.roleType}) goal=${c.goal ?? '未定'} arc=${JSON.stringify(c.arcState ?? {})}`,
          )
          .join('\n') || '(暂无)',
      previousDigest: input.previousDigest || '(这是开篇章节)',
      chapterNumber: input.chapterNumber,
      chapterTitle: input.title,
      hints: input.hints ? `# 用户额外指示\n${input.hints}` : '',
    });

    const raw = await this.llm.complete(system, user, { temperature: 0.7 });
    return {
      outline: raw.trim(),
      themesUsed: usedThemes.map((t) => t.name),
    };
  }

  /**
   * 给下一章起一个非套路、有质感的标题。
   * - 长度 1~10 字
   * - 4 个维度任选:核心动作 / 登场人物名 / 具体物件 / 具体地点或时刻
   * - 用大量风格参考(雪中悍刀行 / 诡秘 / 剑来 / 庆余年)和雷区词清单引导
   * - 用户已经在前端填了大纲/想法时,以大纲为准而不是猜
   */
  async draftTitle(input: {
    novel: NovelEntity;
    chapterNumber: number;
    bible: WorldBibleEntry[];
    characters: CharacterEntity[];
    previousChapter?: ChapterEntity | null;
    ownerId: string;
    /** 用户在前端已经写好的本章大纲(可选);提供时标题应严格基于此 */
    outlineHint?: string;
    /** 用户额外指示 */
    extraHints?: string;
  }): Promise<{ title: string }> {
    const themes = await this.themeRepo.find({
      where: { novelId: input.novel.id },
      order: { priority: 'DESC' },
    });
    const themeDigest =
      themes
        .filter((t) => t.priority >= 5)
        .slice(0, 5)
        .map((t) => `- 【${t.name}】${(t.description ?? '').slice(0, 200)}`)
        .join('\n') || '(暂无)';

    const characterDigest =
      input.characters
        .slice(0, 6)
        .map((c) => `- ${c.name}(${c.roleType})`)
        .join('\n') || '(暂无)';

    const previousDigest = input.previousChapter
      ? `第 ${input.previousChapter.chapterNumber} 章《${input.previousChapter.title}》
大纲: ${input.previousChapter.outline ?? '(无)'}
正文末尾片段: ${(input.previousChapter.content ?? '').slice(-1200) || '(无)'}`
      : '(这是开篇章节,没有上一章)';

    const thisChapterHint = input.outlineHint?.trim()
      ? `\n# 用户已经写好的本章大纲(标题必须精确反映这个,不是猜测!)
${input.outlineHint.slice(0, 1500)}\n`
      : '';

    const userExtra = input.extraHints?.trim()
      ? `\n# 用户额外指示\n${input.extraHints.slice(0, 400)}\n`
      : '';

    const system =
      '你是中文小说的资深编辑,擅长给章节起非套路、有质感的标题。' +
      '只给一行标题,直接是"第N章 标题"格式,不解释,不写括号注释。';

    const userTpl = `# 风格参考(体会它们为什么"有味道")
- 《雪中悍刀行》: 落魄山 / 一拳碎金光 / 老黄背着的木剑 / 北凉王
- 《诡秘之主》: 灰雾 / 红月之夜 / 鳄鱼与大白鲨 / 黑夜 / 名为塔罗的会
- 《剑来》: 出门远游 / 道理在我心头 / 老瞎子 / 三两件烦心事
- 《庆余年》: 京都春日好 / 五竹叔的眼睛 / 那一夜的诗会

特点:像章回小说,具体到一个事 / 一个人 / 一个物 / 一个时刻,不喊口号。

# 雷区(以下词必须避开,这些是套路网文用烂的)
× 觉醒 × 重生之夜 × 震撼 × 怒火 × 决战在即
× 风云突变 × 危机四伏 × 命运转折 × 王者归来 × 巅峰对决
× 修炼之路 × 实力暴涨 × 一战封神

# 选题维度(任选其一)
A. 一个核心动作:出关 / 夜袭 / 立下毒誓 / 一封请柬
B. 一个登场人物名(本章戏份重的可以直接用人名当标题):萧逸尘 / 穿黑袍的老者 / 赵姨娘
C. 一个具体物件:一封信 / 三尺青锋 / 半块玉佩
D. 一个具体地点 / 时刻:落霞山道观 / 子夜三更 / 大雪封山

# 长度
1~10 个汉字。短比长好。"出关"、"老黄"、"一封信" 都是合格的标题。

---

# 上下文
小说: 《{novelTitle}》— {novelSynopsis}

# 主题(必须呼应至少一项)
{themeDigest}

# 主要角色
{characterDigest}

# 关键世界观
{bibleDigest}

# 上一章发生了什么
{previousDigest}
{thisChapterHint}{userExtra}
# 任务
为第 {chapterNumber} 章起一个标题。
- 如果上面给了"用户已写好的本章大纲",标题必须精准切中那个大纲里最核心的"那一下"
- 否则,基于上一章结尾的钩子,推测本章会发生什么核心事件
- 严格遵守上面的雷区和维度选择
- 输出格式只有一行: 第{chapterNumber}章 [标题]`;

    const user = PromptTemplateService.render(userTpl, {
      novelTitle: input.novel.title,
      novelSynopsis: input.novel.synopsis ?? '',
      themeDigest,
      characterDigest,
      bibleDigest:
        input.bible
          .filter((b) => b.importance >= 6)
          .slice(0, 5)
          .map((b) => `- ${b.title}`)
          .join('\n') || '(无)',
      previousDigest,
      thisChapterHint,
      userExtra,
      chapterNumber: input.chapterNumber,
    });

    // 高 temperature 让风格更"野",避开模型默认的"觉醒/重生"套路收敛。
    const raw = await this.llm.complete(system, user, { temperature: 0.95 });

    // 清洗:取第一行 → 去引号 → 把"第N章: 标题"的冒号清掉 → 去末尾标点
    let title = raw.trim().split('\n')[0].trim();
    title = title.replace(/^[「『""'](.+)[」』""']$/, '$1');
    title = title.replace(/[:：]\s*/g, ' ').trim();
    title = title.replace(/[。!?!?]+$/g, '');

    return { title };
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
