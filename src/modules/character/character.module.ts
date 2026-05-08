import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CharacterEntity } from './infrastructure/character.entity';
import { CharacterService } from './application/character.service';
import { CharacterController } from './interfaces/character.controller';
import { NovelModule } from '../novel/novel.module';

@Module({
  imports: [TypeOrmModule.forFeature([CharacterEntity]), NovelModule],
  providers: [CharacterService],
  controllers: [CharacterController],
  exports: [CharacterService],
})
export class CharacterModule {}
