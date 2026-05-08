import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorldBibleEntry } from './infrastructure/world-bible.entity';
import { WorldBibleService } from './application/world-bible.service';
import { WorldBibleController } from './interfaces/world-bible.controller';
import { NovelModule } from '../novel/novel.module';

@Module({
  imports: [TypeOrmModule.forFeature([WorldBibleEntry]), NovelModule],
  providers: [WorldBibleService],
  controllers: [WorldBibleController],
  exports: [WorldBibleService],
})
export class WorldBibleModule {}
