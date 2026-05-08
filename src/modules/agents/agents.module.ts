import { forwardRef, Module } from '@nestjs/common';
import { NovelModule } from '../novel/novel.module';
import { WorldBibleModule } from '../world-bible/world-bible.module';
import { CharacterModule } from '../character/character.module';
import { PromptTemplateModule } from '../prompt-template/prompt-template.module';
import { ChapterModule } from '../chapter/chapter.module';
import { PlotPlannerAgent } from './plot-planner/plot-planner.agent';
import { ContextCompressorAgent } from './context-compressor/context-compressor.agent';
import { ContentGeneratorAgent } from './content-generator/content-generator.agent';
import { ContinuityCheckerAgent } from './continuity-checker/continuity-checker.agent';
import { ChapterOrchestrator } from './orchestrator/chapter.orchestrator';

@Module({
  imports: [
    NovelModule,
    WorldBibleModule,
    CharacterModule,
    PromptTemplateModule,
    forwardRef(() => ChapterModule),
  ],
  providers: [
    PlotPlannerAgent,
    ContextCompressorAgent,
    ContentGeneratorAgent,
    ContinuityCheckerAgent,
    ChapterOrchestrator,
  ],
  exports: [ChapterOrchestrator],
})
export class AgentsModule {}
