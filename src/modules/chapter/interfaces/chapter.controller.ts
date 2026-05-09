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
import { ChapterVersionService } from '../application/chapter-version.service';
import {
  CreateChapterDto,
  DraftOutlineDto,
  DraftTitleDto,
  GenerateChapterDto,
  UpdateChapterDto,
} from './dto/chapter.dto';
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
    private readonly versions: ChapterVersionService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Body() dto: CreateChapterDto,
  ) {
    return this.svc.create(user.id, novelId, dto);
  }

  /**
   * 用户填完章节标题后,前端调用此接口让 AI 给一段建议大纲。
   * 不会落库 —— 只返回文字,前端把它填到 textarea 里供用户继续编辑。
   */
  @Post('draft-outline')
  draftOutline(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Body() dto: DraftOutlineDto,
  ) {
    return this.orchestrator.draftOutline({
      novelId,
      ownerId: user.id,
      title: dto.title,
      hints: dto.hints,
    });
  }

  /**
   * 打开"新建章节"对话框时调,根据小说设定+上一章自动起一个标题。
   * 用户已经填了大纲/想法时(outlineHint/extraHints),标题精准切中那个大纲;
   * 否则基于上一章结尾推测本章核心事件。
   */
  @Post('draft-title')
  draftTitle(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Body() dto: DraftTitleDto,
  ) {
    return this.orchestrator.draftTitle({
      novelId,
      ownerId: user.id,
      outlineHint: dto.outlineHint,
      extraHints: dto.extraHints,
    });
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

  // ===== version snapshots (history / restore) =====

  /** 列出该章节所有版本快照,从新到旧。 */
  @Get(':id/versions')
  listVersions(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.versions.listForChapter(user.id, novelId, id);
  }

  /** 拿单个版本的完整内容(用于在 UI 上预览或对比)。 */
  @Get(':id/versions/:versionId')
  getVersion(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ) {
    return this.versions.getOne(user.id, novelId, id, versionId);
  }

  /**
   * 把章节当前内容回滚到某个历史版本。当前内容会先被自动备份成一个
   * `manual` 版本,所以这是无损操作。
   */
  @Post(':id/versions/:versionId/restore')
  restoreVersion(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ) {
    return this.versions.restore(user.id, novelId, id, versionId);
  }
}
