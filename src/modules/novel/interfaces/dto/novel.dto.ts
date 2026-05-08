import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { NovelStatus } from '../../infrastructure/novel.entity';

export class CreateNovelDto {
  @ApiProperty() @IsString() title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() synopsis?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() genres?: string[];
  @ApiPropertyOptional({ default: 100000 }) @IsOptional() @IsInt() @Min(1000) targetWordCount?: number;
}

export class UpdateNovelDto extends PartialType(CreateNovelDto) {
  @ApiPropertyOptional({ enum: NovelStatus }) @IsOptional() @IsEnum(NovelStatus) status?: NovelStatus;
}
