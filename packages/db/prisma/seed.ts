/**
 * Local-dev seed. Creates one workspace, one editor, one client,
 * one project, and one ready video version so the UI has something to show.
 *
 * Login:
 *   editor@vsp.local  /  EditorPass!42
 *   client@vsp.local  /  ClientPass!42
 */
import { hash } from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const editorPwd = await hash('EditorPass!42', { type: 2 });
  const clientPwd = await hash('ClientPass!42', { type: 2 });

  const editor = await prisma.user.upsert({
    where: { email: 'editor@vsp.local' },
    update: {},
    create: {
      email: 'editor@vsp.local',
      name: 'Sam Editor',
      passwordHash: editorPwd,
      emailVerifiedAt: new Date(),
    },
  });

  const client = await prisma.user.upsert({
    where: { email: 'client@vsp.local' },
    update: {},
    create: {
      email: 'client@vsp.local',
      name: 'Casey Client',
      passwordHash: clientPwd,
      emailVerifiedAt: new Date(),
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      slug: 'demo',
      name: 'Demo Studio',
      plan: 'PRO',
      limits: {
        create: {
          storageBytesCap: BigInt(100 * 1024 ** 3),
          bandwidthBytesCap: BigInt(500 * 1024 ** 3),
          seatsCap: 5,
          aiTokenCap: 2_000_000,
        },
      },
      members: {
        create: [
          { userId: editor.id, role: 'OWNER' },
        ],
      },
    },
  });

  const project = await prisma.project.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      workspaceId: workspace.id,
      ownerId: editor.id,
      name: 'Acme Q3 Launch',
      clientLabel: 'Acme Co.',
      description: 'Hero brand film + 6 social cuts.',
      deadline: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      watermarkTemplate: '{name} · {email} · {date} {time} · CONFIDENTIAL',
      aiSummaryEnabled: true,
      clients: { create: [{ userId: client.id, canDownload: false }] },
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seed complete:', { workspace: workspace.slug, editor: editor.email, project: project.name });
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
