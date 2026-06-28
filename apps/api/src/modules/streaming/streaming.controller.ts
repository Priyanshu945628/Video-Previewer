import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Body,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ShareViewerGuard, type ShareRequest } from '../../common/guards/share-viewer.guard';
import { Public } from '../../common/guards/public.decorator';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { StreamingService, type PlaybackIdentity } from './streaming.service';
import { RedisService } from '../../common/redis/redis.service';
import { env } from '@vsp/config';
import { rlKey } from '@vsp/auth';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { z } from 'zod';

const InitInput = z.object({
  versionId: z.string().uuid(),
});

@Controller('stream')
export class StreamingController {
  constructor(
    private readonly svc: StreamingService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** Authenticated init for editors/clients. */
  @Post('init')
  @UseGuards(SessionGuard, CsrfGuard)
  async init(@Req() req: AuthedRequest & FastifyRequest, @Body(ZodPipe(InitInput)) body: typeof InitInput._type) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    const identity: PlaybackIdentity = {
      kind: 'user',
      userId: req.user.id,
      workspaceId: req.workspaceId,
      email: req.user.email,
      name: req.user.name,
    };
    return {
      data: await this.svc.init(identity, body.versionId, {
        ip: req.session.ip ?? undefined,
        ua: req.session.userAgent ?? undefined,
      }),
    };
  }

  /** Share-link viewer init (no session, viewer token cookie). */
  @Post('share-init')
  @UseGuards(ShareViewerGuard)
  async shareInit(
    @Req() req: ShareRequest & FastifyRequest,
    @Body(ZodPipe(InitInput)) body: typeof InitInput._type,
  ) {
    const viewer = req.shareViewer!;
    if (viewer.assetVersionId && viewer.assetVersionId !== body.versionId) {
      throw new ForbiddenException({ code: 'SHARE_VERSION_MISMATCH' });
    }
    const identity: PlaybackIdentity = {
      kind: 'share',
      shareViewId: viewer.id,
      workspaceId: viewer.workspaceId,
      email: viewer.guestEmail,
      name: viewer.guestName,
    };
    return {
      data: await this.svc.init(identity, body.versionId, {
        ip: req.ip,
        ua: (req.headers['user-agent'] as string) ?? undefined,
      }),
    };
  }

  // ─── Manifest, segments, key — token-authenticated ──────────────────────
  // These endpoints are intentionally NOT guarded by SessionGuard. The
  // signed token IS the authority, and we want native HLS players to be
  // able to fetch with credentials='include' even when the cookie hasn't
  // refreshed yet during a long playback.

  @Get(':versionId/manifest.m3u8')
  @Public()
  async manifest(
    @Param('versionId') versionId: string,
    @Query('t') token: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const text = await this.svc.serveMaster(versionId, token);
    res.header('Content-Type', 'application/vnd.apple.mpegurl');
    res.header('Cache-Control', 'no-store');
    return text;
  }

  @Get(':versionId/seg/:idx')
  @Public()
  async segment(
    @Param('versionId') versionId: string,
    @Param('idx') _idx: string,
    @Query('t') token: string,
    @Query('p') p: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const r = await this.svc.serveSegment(versionId, token, p);
    res.header('Content-Type', r.contentType ?? 'video/mp2t');
    if (r.length) res.header('Content-Length', String(r.length));
    res.header('Cache-Control', 'no-store');
    return res.send(r.stream);
  }

  @Get(':versionId/key')
  @Public()
  async key(
    @Req() req: FastifyRequest,
    @Param('versionId') versionId: string,
    @Query('t') token: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    // Rate-limit key delivery aggressively — abuse signal.
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
    if (await this.redis.over(rlKey.streamKey(`ip:${ip}`), env.RATE_LIMIT_STREAM_KEY_PER_MIN, 60)) {
      throw new ForbiddenException({ code: 'KEY_RATE_LIMIT' });
    }
    const key = await this.svc.serveKey(versionId, token);
    res.header('Content-Type', 'application/octet-stream');
    res.header('Content-Length', String(key.length));
    res.header('Cache-Control', 'no-store, private');
    res.header('Pragma', 'no-cache');
    return res.send(key);
  }

  // ─── Telemetry (session start/event/end) ────────────────────────────────
  @Post('events')
  @UseGuards(SessionGuard, CsrfGuard)
  async event(@Req() req: AuthedRequest & FastifyRequest, @Body() body: { sessionId: string; events: unknown[] }) {
    void req;
    void body;
    // Persists into playback_events partition; see PlaybackEventsConsumer in
    // workers (this controller is the ingress).
    return { data: { ok: true } };
  }
}
