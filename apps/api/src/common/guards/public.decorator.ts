import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'auth:public';
export const SHARE_KEY = 'auth:share';
export const ROLES_KEY = 'auth:roles';

/** Skip session + share auth entirely (e.g. health, login, signup). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Route is authenticated by share token only (no user session). */
export const ShareOnly = () => SetMetadata(SHARE_KEY, true);

/** Require one of the given roles. */
export const Roles = (...roles: Array<'OWNER' | 'ADMIN' | 'EDITOR' | 'COLLABORATOR' | 'CLIENT'>) =>
  SetMetadata(ROLES_KEY, roles);
