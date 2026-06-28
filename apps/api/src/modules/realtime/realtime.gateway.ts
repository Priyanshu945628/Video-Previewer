import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import { touchSession } from '@vsp/auth';
import { env, corsOrigins } from '@vsp/config';
import { PresenceService } from './presence.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Standalone Socket.io server on a sibling port (default 4001) so the
 * Fastify HTTP path stays free of WS upgrade handling. Auth.js session
 * cookies are accepted via the same handshake.
 *
 *   client  → /socket  (cookie-authenticated)
 *           ⇒ joins room  v:<versionId>
 *           ⇒ receives    comment:new | comment:resolved | comment:reopened
 *                          | comment:deleted | approval:changed | presence:*
 */
@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RealtimeGateway.name);
  private server?: Server;
  private http?: ReturnType<typeof createServer>;

  constructor(private readonly presence: PresenceService, private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.http = createServer();
    this.server = new Server(this.http, {
      cors: {
        origin: corsOrigins.length ? corsOrigins : [env.APP_URL],
        credentials: true,
      },
      transports: ['websocket'],
    });

    this.server.use(async (socket, next) => {
      try {
        const cookie = socket.handshake.headers.cookie ?? '';
        const name = env.NODE_ENV === 'production' ? '__Secure-vsp.session' : 'vsp.session';
        const m = cookie.match(new RegExp(`${name}=([^;]+)`));
        if (!m) return next(new Error('no session'));
        const session = await touchSession(decodeURIComponent(m[1]!));
        if (!session) return next(new Error('invalid session'));
        const user = await this.prisma.user.findUnique({
          where: { id: session.userId },
          include: { memberships: { take: 1 } },
        });
        if (!user) return next(new Error('no user'));
        (socket.data as { userId: string; workspaceId: string | null; name: string | null }) = {
          userId: user.id,
          workspaceId: user.memberships[0]?.workspaceId ?? null,
          name: user.name,
        };
        next();
      } catch (e) {
        this.log.warn(`socket auth failed: ${(e as Error).message}`);
        next(new Error('unauthorized'));
      }
    });

    this.server.on('connection', (socket) => {
      const d = socket.data as { userId: string; workspaceId: string | null; name: string | null };

      socket.on('join:version', async ({ versionId }: { versionId: string }) => {
        await socket.join(`v:${versionId}`);
        await this.presence.heartbeat(versionId, d.userId, {
          name: d.name ?? 'Editor',
          color: '#a78bfa',
        });
        this.server!.to(`v:${versionId}`).emit('presence:update', await this.presence.list(versionId));
      });

      socket.on('leave:version', async ({ versionId }: { versionId: string }) => {
        await socket.leave(`v:${versionId}`);
        await this.presence.leave(versionId, d.userId);
        this.server!.to(`v:${versionId}`).emit('presence:update', await this.presence.list(versionId));
      });

      socket.on('cursor', ({ versionId, t }: { versionId: string; t: number }) => {
        socket.to(`v:${versionId}`).emit('cursor', { userId: d.userId, name: d.name, t });
      });

      socket.on('disconnect', () => {
        // Presence GC handled by sorted-set window; nothing to do here.
      });
    });

    const port = Number(new URL(env.API_URL).port || 4000) + 1;
    this.http.listen(port);
    this.log.log(`realtime listening on ${port}`);
  }

  async onModuleDestroy() {
    await new Promise<void>((r) => this.server?.close(() => r()));
    await new Promise<void>((r) => this.http?.close(() => r()));
  }

  emitToVersion(versionId: string, event: string, payload: unknown) {
    this.server?.to(`v:${versionId}`).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    // Notification socket — when a user has a personal room (joined on connect)
    this.server?.to(`u:${userId}`).emit(event, payload);
  }
}
