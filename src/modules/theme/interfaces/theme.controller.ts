import {
  BadRequestException,
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
import { ThemeService } from '../application/theme.service';
import { CreateThemeDto, PolishThemeDto, UpdateThemeDto } from './dto/theme.dto';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../user/domain/user-role.enum';
import { PolishAgent, PolishContextType } from '../../agents/polish/polish.agent';

@ApiBearerAuth()
@ApiTags('themes')
@Roles(UserRole.AUTHOR, UserRole.ADMIN)
@Controller('novels/:novelId/themes')
export class ThemeController {
  constructor(private readonly svc: ThemeService, private readonly polish: PolishAgent) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Body() dto: CreateThemeDto,
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
    @Body() dto: UpdateThemeDto,
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
   * 调 AI 润色当前主题的 description。
   * 默认 dry-run(只返回润色结果),`save=true` 时直接覆盖 description 并把
   * 旧版本存入 previousDescription(可通过 POST :id/revert 回滚)。
   */
  @Post(':id/polish')
  async polishTheme(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PolishThemeDto,
  ) {
    const theme = await this.svc.getOwned(user.id, novelId, id);
    if (!theme.description?.trim()) {
      throw new BadRequestException('Cannot polish an empty description');
    }

    const result = await this.polish.polish({
      text: theme.description,
      contextType: PolishContextType.THEME,
      ownerId: user.id,
      novelId,
      extraInstructions: dto.extraInstructions,
      hints: { name: theme.name, tags: theme.tags ?? [] },
    });

    if (dto.save) {
      const updated = await this.svc.applyPolish(user.id, novelId, id, result.polished);
      return { ...result, theme: updated };
    }
    return result;
  }

  @Post(':id/revert')
  revert(
    @CurrentUser() user: AuthUser,
    @Param('novelId', new ParseUUIDPipe()) novelId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.revertPolish(user.id, novelId, id);
  }
}
