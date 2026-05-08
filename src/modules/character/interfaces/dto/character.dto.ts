import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { CharacterRoleType } from '../../infrastructure/character.entity';

export class CreateCharacterDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: CharacterRoleType }) @IsEnum(CharacterRoleType) roleType!: CharacterRoleType;
  @ApiPropertyOptional() @IsOptional() @IsString() appearance?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() personality?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() background?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() goal?: string;
  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  relationships?: { characterId: string; relation: string; note?: string }[];
  @ApiPropertyOptional() @IsOptional() @IsObject() arcState?: Record<string, unknown>;
}

export class UpdateCharacterDto extends PartialType(CreateCharacterDto) {}
