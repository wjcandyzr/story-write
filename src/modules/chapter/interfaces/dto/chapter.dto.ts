import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ChapterStatus } from '../../infrastructure/chapter.entity';

export class CreateChapterDto {
  @ApiProperty() @IsString() title!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) chapterNumber?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() outline?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
}

export class UpdateChapterDto extends PartialType(CreateChapterDto) {
  @ApiPropertyOptional({ enum: ChapterStatus }) @IsOptional() @IsEnum(ChapterStatus) status?: ChapterStatus;
}

export class GenerateChapterDto {
  @ApiPropertyOptional({ description: 'Optional thread id for resuming a previous LangGraph run' })
  @IsOptional() @IsString() threadId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() extraInstructions?: string;
}

export class DraftOutlineDto {
  @ApiProperty({ description: '用户刚填的章节标题' }) @IsString() title!: string;
  @ApiPropertyOptional({ description: '可选,用户对本章的额外想法/约束' })
  @IsOptional() @IsString() hints?: string;
}

export class DraftTitleDto {
  @ApiPropertyOptional({ description: '可选,用户已写好的本章大纲;有则标题以此为准' })
  @IsOptional() @IsString() outlineHint?: string;
  @ApiPropertyOptional({ description: '可选,用户对本章的额外想法' })
  @IsOptional() @IsString() extraHints?: string;
}
