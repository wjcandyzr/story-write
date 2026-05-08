import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateThemeDto {
  @ApiProperty({ example: '末世废土' }) @IsString() @MaxLength(60) name!: string;

  @ApiPropertyOptional({ example: '主角在丧尸潮中挣扎求生,寻找传说中的避难所...' })
  @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional({ type: [String], example: ['丧尸', '末日生存', '硬科幻'] })
  @IsOptional() @IsArray() tags?: string[];

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 10 })
  @IsOptional() @IsInt() @Min(1) @Max(10) priority?: number;
}

export class UpdateThemeDto extends PartialType(CreateThemeDto) {}

export class PolishThemeDto {
  @ApiPropertyOptional({ description: '可选的额外指示,例如 "更悬疑一些"' })
  @IsOptional() @IsString() extraInstructions?: string;

  @ApiPropertyOptional({ default: false, description: 'true=直接保存到 description,false=只返回不保存' })
  @IsOptional() @IsBoolean() save?: boolean;
}
