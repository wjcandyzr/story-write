import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NovelModule } from '../novel/novel.module';
import { WorldBibleModule } from '../world-bible/world-bible.module';
import { CharacterModule } from '../character/character.module';
import { PromptTemplateModule } from '../prompt-template/prompt-template.module';
import { ChapterModule } from '../chapter/chapter.module';
import { ThemeEntity } from '../theme/infrastructure/theme.entity';
import { PlotPlannerAgent } from './plot-planner/plot-planner.agent';
import { ContextCompressorAgent } from './context-compressor/context-compressor.agent';
import { ContentGeneratorAgent } from './content-generator/content-generator.agent';
import { ContinuityCheckerAgent } from './continuity-checker/continuity-checker.agent';
import { PolishAgent } from './polish/polish.agent';
import { ChapterOrchestrator } from './orchestrator/chapter.orchestrator';

@Module({
  imports: [
    NovelModule,
    WorldBibleModule,
    CharacterModule,
    PromptTemplateModule,
    forwardRef(() => ChapterModule),
    // Direct repo registration (instead of importing ThemeModule) so the planner
    // can read themes without creating a circular dep with ThemeModule.
    TypeOrmModule.forFeature([ThemeEntity]),
  ],
  providers: [
    PlotPlannerAgent,
    ContextCompressorAgent,
    ContentGeneratorAgent,
    ContinuityCheckerAgent,
    PolishAgent,
    ChapterOrchestrator,
  ],
  exports: [ChapterOrchestrator, PolishAgent, PlotPlannerAgent],
})
export class AgentsModule {}
