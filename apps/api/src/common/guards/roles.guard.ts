import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './public.decorator';
import type { AuthedRequest } from './session.guard';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles?.length) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new ForbiddenException({ code: 'NO_ROLE', message: 'Forbidden.' });
    if (!roles.includes(req.user.role)) {
      throw new ForbiddenException({ code: 'ROLE_DENIED', message: 'Insufficient role.' });
    }
    return true;
  }
}
