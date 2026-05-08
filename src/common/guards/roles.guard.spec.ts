import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../modules/user/domain/user-role.enum';

function mkCtx(user: { roles?: string[] } | null = null): ExecutionContext {
  return {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows when no roles required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(mkCtx({ roles: ['anything'] }))).toBe(true);
  });

  it('rejects with no principal', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(mkCtx(null))).toThrow(ForbiddenException);
  });

  it('rejects when user lacks any of the required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(mkCtx({ roles: [UserRole.READER] }))).toThrow(ForbiddenException);
  });

  it('passes when user has at least one required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.AUTHOR, UserRole.ADMIN]);
    expect(guard.canActivate(mkCtx({ roles: [UserRole.AUTHOR] }))).toBe(true);
  });
});
