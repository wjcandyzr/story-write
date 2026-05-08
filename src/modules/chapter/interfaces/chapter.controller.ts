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
import { ChapterService } from '../application/chapter.service';
import { CreateChapterDto, GenerateChapterDto, UpdateChapterDto } from './dto/chapter.dto';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../user/domain/user-role.enum';
import { ChapterOrchestrator } from '../../agents/orchestrator/chapter.orchestrator';

@ApiBearerAuth()
@ApiTags('chapters')
@Roles(UserRole.AUTHOR, UserRole.ADMIN)
@Controller('novels/:novelId/chapters')
export class ChapterController {
  constructor(
    private readonly svc: ChapterService,
    private readonly orchestrator: ChapterOrchestrator,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Body() dto: CreateChapterDto,
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
    @Body() dto: UpdateChapterDto,
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

  /**
   * Trigger non-streaming chapter generation. Streaming is exposed via the
   * `chapter` WebSocket gateway — see `ChapterGateway`.
   */
  @Post(':id/generate')
  async generate(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GenerateChapterDto,
  ) {
    await this.svc.getOwned(user.id, novelId, id);
    return this.orchestrator.runChapter({
      novelId,
      chapterId: id,
      ownerId: user.id,
      threadId: dto.threadId,
      extraInstructions: dto.extraInstructions,
    });
  }
}
