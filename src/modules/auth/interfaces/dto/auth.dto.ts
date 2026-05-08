import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty() @IsString() @MinLength(3) username!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;
}

export class LoginDto {
  @ApiProperty() @IsString() username!: string;
  @ApiProperty() @IsString() password!: string;
}
