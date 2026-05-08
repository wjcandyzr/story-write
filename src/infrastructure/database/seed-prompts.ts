/**
 * Idempotent seeder for built-in (system) prompt templates.
 * Run via: ts-node src/infrastructure/database/seed-prompts.ts
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import dataSource from './data-source';
import {
  PromptScope,
  PromptTemplate,
} from '../../modules/prompt-template/infrastructure/prompt-template.entity';

loadEnv();

const SYSTEM_TEMPLATES: Array<Partial<PromptTemplate>> = [
  {
    name: 'builtin.plot_planner.v1',
    scope: PromptScope.PLOT_PLANNER,
    systemPrompt:
      'You are a master story architect for long-form Chinese web novels. Plan the next chapter in JSON.',
    userTemplate:
      'See default in PlotPlannerAgent — overridden here only when the operator wants a custom variant.',
    variables: ['novelTitle', 'chapterNumber', 'previousSummary'],
    version: 1,
    active: false, // disabled by default; agents fall back to in-code template
  },
  {
    name: 'builtin.context_compressor.v1',
    scope: PromptScope.CONTEXT_COMPRESSOR,
    systemPrompt:
      'You are a story memory compressor. Distill the past chapters into a tight summary preserving causality, character states, world facts and unresolved threads.',
    userTemplate: '(see in-code default)',
    variables: ['ancientDigest', 'recentDigest', 'targetTokens'],
    version: 1,
    active: false,
  },
];

async function main() {
  await dataSource.initialize();
  const repo = dataSource.getRepository(PromptTemplate);
  for (const tpl of SYSTEM_TEMPLATES) {
    const existing = await repo.findOne({
      where: { name: tpl.name!, version: tpl.version!, ownerId: undefined as unknown as never },
    });
    if (existing) {
      console.log(`skip ${tpl.name}@${tpl.version}`);
      continue;
    }
    await repo.save(repo.create({ ...tpl, ownerId: null }));
    console.log(`seeded ${tpl.name}@${tpl.version}`);
  }
  await dataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
