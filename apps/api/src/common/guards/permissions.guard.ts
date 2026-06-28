import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from './session.guard';

export type Capability =
  | 'project.read'
  | 'project.write'
  | 'asset.read'
  | 'asset.write'
  | 'comment.read'
  | 'comment.write'
  | 'approval.write'
  | 'share.write'
  | 'admin.read'
  | 'admin.write'
  | 'workspace.admin';

const ROLE_CAPS: Record<string, Set<Capability>> = {
  OWNER: new Set<Capability>([
    'project.read', 'project.write',
    'asset.read', 'asset.write',
    'comment.read', 'comment.write',
    'approval.write', 'share.write',
    'admin.read', 'admin.write', 'workspace.admin',
  ]),
  ADMIN: new Set<Capability>([
    'project.read', 'project.write',
    'asset.read', 'asset.write',
    'comment.read', 'comment.write',
    'approval.write', 'share.write',
    'admin.read', 'admin.write', 'workspace.admin',
  ]),
  EDITOR: new Set<Capability>([
    'project.read', 'project.write',
    'asset.read', 'asset.write',
    'comment.read', 'comment.write',
    'approval.write', 'share.write',
  ]),
  COLLABORATOR: new Set<Capability>([
    'project.read',
    'asset.read',
    'comment.read', 'comment.write',
  ]),
  CLIENT: new Set<Capability>([
    'project.read',
    'asset.read',
    'comment.read', 'comment.write',
    'approval.write',
  ]),
};

const PERMS_KEY = 'auth:perms';

export const Permissions = (...caps: Capability[]) => SetMetadata(PERMS_KEY, caps);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Capability[] | undefined>(PERMS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new ForbiddenException({ code: 'NO_USER' });
    const caps = ROLE_CAPS[req.user.role];
    if (!caps) throw new ForbiddenException({ code: 'NO_ROLE' });
    for (const c of required) {
      if (!caps.has(c)) throw new ForbiddenException({ code: 'CAP_DENIED', message: c });
    }
    return true;
  }
}
