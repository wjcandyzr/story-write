import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThemeEntity } from './infrastructure/theme.entity';
import { ThemeService } from './application/theme.service';
import { ThemeController } from './interfaces/theme.controller';
import { NovelModule } from '../novel/novel.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [TypeOrmModule.forFeature([ThemeEntity]), NovelModule, AgentsModule],
  providers: [ThemeService],
  controllers: [ThemeController],
  exports: [ThemeService],
})
export class ThemeModule {}
