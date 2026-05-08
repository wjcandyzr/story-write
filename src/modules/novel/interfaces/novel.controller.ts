import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NovelService } from '../application/novel.service';
import { CreateNovelDto, UpdateNovelDto } from './dto/novel.dto';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../user/domain/user-role.enum';

@ApiBearerAuth()
@ApiTags('novels')
@Roles(UserRole.AUTHOR, UserRole.ADMIN)
@Controller('novels')
export class NovelController {
  constructor(private readonly svc: NovelService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNovelDto) {
    return this.svc.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() p: PaginationDto) {
    return this.svc.list(user.id, p);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.getOwned(id, user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateNovelDto,
  ) {
    return this.svc.update(id, user.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.remove(id, user.id);
  }
}
