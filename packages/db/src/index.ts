/**
 * @vsp/db — Prisma client + RLS-aware transaction helpers.
 *
 * Every request should run inside `withTenant(...)` so RLS GUCs are set
 * BEFORE any query touches the DB. Workers that need cross-tenant access
 * must use `withRlsBypass(...)` — every call is also audit-logged at the
 * call site, never silently.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { env, isProduction } from '@vsp/config';
import { createLogger } from '@vsp/logger';

export * from '@prisma/client';

const log = createLogger('db');

declare global {
  // eslint-disable-next-line no-var
  var __vsp_prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__vsp_prisma ??
  new PrismaClient({
    log: isProduction
      ? [{ emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProduction) globalThis.__vsp_prisma = prisma;

prisma.$on('error' as never, (e: { message: string }) => log.error({ err: e }, 'prisma error'));

// ─── Tenant + user GUC binding ───────────────────────────────────────────────
export type TenantContext = {
  workspaceId: string;
  userId?: string;
  role?: 'owner' | 'admin' | 'editor' | 'collaborator' | 'client' | 'share_view';
};

/**
 * Run `fn` inside a transaction with RLS GUCs set. Any query inside `fn`
 * is scoped to the workspace; nothing else can leak across tenants.
 *
 * IMPORTANT: do not nest. If you need a sub-step with bypass, pass the
 * client explicitly to a helper that calls withRlsBypass on a fresh tx.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.workspace_id = '${ctx.workspaceId}'`);
    if (ctx.userId) await tx.$executeRawUnsafe(`SET LOCAL app.user_id = '${ctx.userId}'`);
    if (ctx.role) await tx.$executeRawUnsafe(`SET LOCAL app.role = '${ctx.role}'`);
    await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'off'`);
    return fn(tx);
  });
}

/**
 * Bypass RLS — for system-level operations (workers, schedulers, admin tools).
 * Every caller MUST be auditable (see AuditService.systemEvent).
 */
export async function withRlsBypass<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
    return fn(tx);
  });
}

export type Tx = Prisma.TransactionClient;
