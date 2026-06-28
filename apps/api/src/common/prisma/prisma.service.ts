import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient, withTenant, withRlsBypass, type TenantContext, type Tx } from '@vsp/db';
import { createLogger } from '@vsp/logger';

const log = createLogger('prisma');

/**
 * Wraps PrismaClient. Exposes `withTenant()` and `withRlsBypass()` — the
 * only two paths that should ever execute queries against multi-tenant
 * tables. Direct `this.*` access is reserved for the few system tables
 * (sessions, verification_tokens, etc.) where RLS isn't needed.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    log.info('prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(ctx, fn);
  }

  withRlsBypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRlsBypass(fn);
  }
}
