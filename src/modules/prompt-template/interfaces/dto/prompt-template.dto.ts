import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PromptScope } from '../../infrastructure/prompt-template.entity';

export class CreatePromptTemplateDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: PromptScope }) @IsEnum(PromptScope) scope!: PromptScope;
  @ApiProperty() @IsString() systemPrompt!: string;
  @ApiProperty() @IsString() userTemplate!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() variables?: string[];
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) version?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdatePromptTemplateDto extends PartialType(CreatePromptTemplateDto) {}
