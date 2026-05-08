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
