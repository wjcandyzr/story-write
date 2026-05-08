import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PromptTemplateService } from '../application/prompt-template.service';
import { CreatePromptTemplateDto, UpdatePromptTemplateDto } from './dto/prompt-template.dto';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../user/domain/user-role.enum';

@ApiBearerAuth()
@ApiTags('prompt-templates')
@Roles(UserRole.AUTHOR, UserRole.ADMIN)
@Controller('prompt-templates')
export class PromptTemplateController {
  constructor(private readonly svc: PromptTemplateService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePromptTemplateDto) {
    return this.svc.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() p: PaginationDto) {
    return this.svc.list(user.id, p);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.getById(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePromptTemplateDto,
  ) {
    return this.svc.update(id, user.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.remove(id, user.id);
  }
}
