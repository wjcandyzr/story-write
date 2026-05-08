import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WorldBibleService } from '../application/world-bible.service';
import { CreateWorldBibleDto, UpdateWorldBibleDto } from './dto/world-bible.dto';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../user/domain/user-role.enum';

@ApiBearerAuth()
@ApiTags('world-bible')
@Roles(UserRole.AUTHOR, UserRole.ADMIN)
@Controller('novels/:novelId/world-bible')
export class WorldBibleController {
  constructor(private readonly svc: WorldBibleService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Body() dto: CreateWorldBibleDto,
  ) {
    return this.svc.create(user.id, novelId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Query() p: PaginationDto,
  ) {
    return this.svc.list(user.id, novelId, p);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.getOwned(user.id, novelId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateWorldBibleDto,
  ) {
    return this.svc.update(user.id, novelId, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.remove(user.id, novelId, id);
  }
}
