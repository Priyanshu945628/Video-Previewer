import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { touchSession } from '@vsp/auth';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_KEY, SHARE_KEY } from './public.decorator';

export interface AuthedRequest {
  user: {
    id: string;
    email: string;
    name: string | null;
    workspaceId: string | null;
    role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'COLLABORATOR' | 'CLIENT';
  };
  session: {
    id: string;
    token: string;
    ip: string | null;
    userAgent: string | null;
    fingerprintHash: string | null;
  };
  workspaceId: string | null;
  shareViewerId?: string;
  cookies: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

/**
 * SessionGuard — verifies the Auth.js session cookie and binds workspace
 * scope. Skips public + share-token-only routes (those use ShareViewerGuard).
 *
 * Idle + absolute timeouts and "logged-out everywhere" revocation are
 * enforced inside `touchSession`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const isShareOnly = this.reflector.getAllAndOverride<boolean>(SHARE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isShareOnly) return true; // ShareViewerGuard will handle it.

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const cookieName =
      process.env.NODE_ENV === 'production' ? '__Secure-vsp.session' : 'vsp.session';
    const token = req.cookies?.[cookieName];
    if (!token) throw new UnauthorizedException({ code: 'NO_SESSION', message: 'Sign in required.' });

    const session = await touchSession(token);
    if (!session) throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Session expired.' });

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        memberships: { select: { workspaceId: true, role: true }, take: 1 },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_INACTIVE', message: 'Account not active.' });
    }

    const membership = user.memberships[0];
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      workspaceId: membership?.workspaceId ?? null,
      role: (membership?.role ?? 'CLIENT') as AuthedRequest['user']['role'],
    };
    req.workspaceId = membership?.workspaceId ?? null;
    req.session = {
      id: session.id,
      token,
      ip: session.ip,
      userAgent: session.userAgent,
      fingerprintHash: session.fingerprintHash,
    };

    return true;
  }
}
