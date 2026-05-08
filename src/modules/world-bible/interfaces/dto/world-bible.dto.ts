import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { WorldBibleCategory } from '../../infrastructure/world-bible.entity';

export class CreateWorldBibleDto {
  @ApiProperty() @IsString() title!: string;
  @ApiProperty({ enum: WorldBibleCategory }) @IsEnum(WorldBibleCategory) category!: WorldBibleCategory;
  @ApiProperty() @IsString() content!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() tags?: string[];
  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 10 })
  @IsOptional() @IsInt() @Min(1) @Max(10) importance?: number;
}

export class UpdateWorldBibleDto extends PartialType(CreateWorldBibleDto) {}
