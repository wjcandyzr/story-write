import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptTemplate } from './infrastructure/prompt-template.entity';
import { PromptTemplateService } from './application/prompt-template.service';
import { PromptTemplateController } from './interfaces/prompt-template.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PromptTemplate])],
  providers: [PromptTemplateService],
  controllers: [PromptTemplateController],
  exports: [PromptTemplateService],
})
export class PromptTemplateModule {}
