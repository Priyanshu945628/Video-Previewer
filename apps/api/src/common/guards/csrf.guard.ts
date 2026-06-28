import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { constantTimeEqual } from '@vsp/crypto';
import { PUBLIC_KEY } from './public.decorator';

/**
 * Double-submit CSRF protection for state-changing methods.
 *
 *   - Web sets `vsp.csrf` HttpOnly cookie at login.
 *   - Web reads the matching value from a small `__vsp_csrf` token cookie
 *     (non-HttpOnly) and echoes it in the `X-CSRF-Token` header.
 *   - This guard verifies they match in constant time.
 *
 * GET / HEAD / OPTIONS are skipped (safe methods, no state change).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      method: string;
      cookies: Record<string, string>;
      headers: Record<string, string | string[] | undefined>;
    }>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const cookie = req.cookies?.['__vsp_csrf'];
    const header = req.headers['x-csrf-token'];
    if (!cookie || !header || Array.isArray(header)) {
      throw new ForbiddenException({ code: 'CSRF_MISSING', message: 'CSRF token missing.' });
    }
    if (!constantTimeEqual(cookie, header)) {
      throw new ForbiddenException({ code: 'CSRF_INVALID', message: 'CSRF token invalid.' });
    }
    return true;
  }
}
