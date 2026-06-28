/**
 * Integration test — ProjectsService against a real Postgres (Testcontainers).
 *
 * Verifies the things mocks would miss:
 *   - withTenant correctly scopes queries by GUC
 *   - cross-tenant access through the same Prisma client is blocked by RLS
 *   - audit_events row is written on each mutation
 *
 * Skipped in unit runs; CI sets VSP_INTEGRATION=1 to enable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Test, type TestingModule } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { ProjectsService } from './projects.service';
import { ProjectsRepository } from './projects.repository';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const SHOULD_RUN = process.env.VSP_INTEGRATION === '1';

(SHOULD_RUN ? describe : describe.skip)('ProjectsService (integration)', () => {
  let pg: StartedPostgreSqlContainer;
  let mod: TestingModule;
  let svc: ProjectsService;
  let prisma: PrismaService;
  let wsA: string;
  let wsB: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env.DATABASE_URL = pg.getConnectionUri();
    process.env.DATABASE_DIRECT_URL = pg.getConnectionUri();

    execSync('pnpm --filter @vsp/db migrate:deploy', { stdio: 'inherit' });

    mod = await Test.createTestingModule({
      providers: [ProjectsService, ProjectsRepository, PrismaService, AuditService],
    }).compile();

    svc = mod.get(ProjectsService);
    prisma = mod.get(PrismaService);
    await prisma.onModuleInit();

    // Seed two tenants.
    const a = await prisma.workspace.create({ data: { slug: 'a', name: 'A' } });
    const b = await prisma.workspace.create({ data: { slug: 'b', name: 'B' } });
    const ua = await prisma.user.create({ data: { email: 'a@a.co', name: 'A' } });
    const ub = await prisma.user.create({ data: { email: 'b@b.co', name: 'B' } });
    await prisma.workspaceMember.create({ data: { workspaceId: a.id, userId: ua.id, role: 'OWNER' } });
    await prisma.workspaceMember.create({ data: { workspaceId: b.id, userId: ub.id, role: 'OWNER' } });
    wsA = a.id; wsB = b.id; userA = ua.id; userB = ub.id;
  }, 60_000);

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await pg?.stop();
  });

  it('creates a project scoped to the caller workspace', async () => {
    const p = await svc.create(wsA, userA, {
      name: 'A1', allowDownloadDefault: false, requireTwoFactorOnApprove: false, aiSummaryEnabled: false,
    });
    expect(p.workspaceId).toBe(wsA);
  });

  it('cannot read a project from another workspace via withTenant', async () => {
    const p = await svc.create(wsA, userA, {
      name: 'A2', allowDownloadDefault: false, requireTwoFactorOnApprove: false, aiSummaryEnabled: false,
    });
    // userB / wsB asking for wsA's project ID — RLS returns null.
    await expect(svc.get(wsB, userB, p.id)).rejects.toMatchObject({ response: { code: 'PROJECT_NOT_FOUND' } });
  });

  it('writes audit_events for created projects', async () => {
    const p = await svc.create(wsA, userA, {
      name: 'A3', allowDownloadDefault: false, requireTwoFactorOnApprove: false, aiSummaryEnabled: false,
    });
    const events = await prisma.auditEvent.findMany({
      where: { workspaceId: wsA, action: 'project.created', targetId: p.id },
    });
    expect(events.length).toBe(1);
    expect(events[0]!.hash).not.toBe('pending');
  });
});
