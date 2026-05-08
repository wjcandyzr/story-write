import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NovelEntity } from './infrastructure/novel.entity';
import { NovelService } from './application/novel.service';
import { NovelController } from './interfaces/novel.controller';

@Module({
  imports: [TypeOrmModule.forFeature([NovelEntity])],
  providers: [NovelService],
  controllers: [NovelController],
  exports: [NovelService, TypeOrmModule],
})
export class NovelModule {}
