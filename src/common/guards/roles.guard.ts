import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../modules/user/domain/user-role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // 与 JwtAuthGuard 一致:非 HTTP 上下文(WebSocket / RPC)放行,
    // switchToHttp().getRequest() 在 ws 上是 undefined,会直接炸。
    if (ctx.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = ctx.switchToHttp().getRequest();
    if (!user || !user.roles) throw new ForbiddenException('No roles on principal');

    const ok = required.some((r) => user.roles.includes(r));
    if (!ok) throw new ForbiddenException(`Requires one of: ${required.join(', ')}`);
    return true;
  }
}
