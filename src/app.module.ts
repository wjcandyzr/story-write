import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { databaseConfig } from './infrastructure/database/database.config';
import { RedisModule } from './infrastructure/redis/redis.module';
import { LlmModule } from './infrastructure/llm/llm.module';
import { CheckpointModule } from './infrastructure/checkpoint/checkpoint.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { WorldBibleModule } from './modules/world-bible/world-bible.module';
import { CharacterModule } from './modules/character/character.module';
import { PromptTemplateModule } from './modules/prompt-template/prompt-template.module';
import { NovelModule } from './modules/novel/novel.module';
import { ChapterModule } from './modules/chapter/chapter.module';
import { AgentsModule } from './modules/agents/agents.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    TypeOrmModule.forRootAsync(databaseConfig),
    RedisModule,
    LlmModule,
    CheckpointModule,
    AuthModule,
    UserModule,
    WorldBibleModule,
    CharacterModule,
    PromptTemplateModule,
    NovelModule,
    ChapterModule,
    AgentsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
