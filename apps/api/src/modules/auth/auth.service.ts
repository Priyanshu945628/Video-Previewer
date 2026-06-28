import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import {
  hashPassword,
  verifyPassword,
  enrollTotp,
  verifyTotp,
  persistSession,
  labelFromUserAgent,
  rlKey,
} from '@vsp/auth';
import { recoveryCodes, sha256Hex } from '@vsp/crypto';
import type { SignupInputDto, LoginInputDto } from '@vsp/contracts';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  // ─── Signup ─────────────────────────────────────────────────────────────
  async signup(input: SignupInputDto, meta: { ip: string; ua: string }) {
    if (await this.redis.over(rlKey.signup(meta.ip), 5, 600)) {
      throw new BadRequestException({ code: 'SIGNUP_RATE_LIMIT', message: 'Try again later.' });
    }
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException({ code: 'EMAIL_IN_USE' });

    const passwordHash = await hashPassword(input.password);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          status: 'PENDING_VERIFICATION',
        },
      });
      const workspace = await tx.workspace.create({
        data: {
          slug: input.workspaceName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60),
          name: input.workspaceName,
          plan: 'FREE',
          members: { create: { userId: user.id, role: 'OWNER' } },
          limits: {
            create: {
              storageBytesCap: BigInt(10 * 1024 ** 3),
              bandwidthBytesCap: BigInt(50 * 1024 ** 3),
              seatsCap: 3,
              aiTokenCap: 500_000,
            },
          },
        },
      });
      return { user, workspace };
    });

    await this.audit.emit({
      action: 'user.signed_up',
      actor: { kind: 'user', userId: result.user.id, workspaceId: result.workspace.id },
      targetType: 'user',
      targetId: result.user.id,
    });
    return result;
  }

  // ─── Login (called from the web app's server action) ────────────────────
  async login(input: LoginInputDto, meta: { ip: string; ua: string; fingerprintHash?: string }) {
    if (await this.redis.over(rlKey.login(input.email, meta.ip), 5, 60)) {
      throw new BadRequestException({ code: 'LOGIN_RATE_LIMIT' });
    }
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { authenticators: { where: { kind: 'TOTP' } } },
    });
    if (!user || !user.passwordHash) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({ code: 'ACCOUNT_LOCKED' });
    }
    if (user.status === 'SUSPENDED') throw new UnauthorizedException({ code: 'ACCOUNT_SUSPENDED' });

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: { increment: 1 },
          lockedUntil:
            user.failedLoginCount + 1 >= 10
              ? new Date(Date.now() + 15 * 60 * 1000)
              : undefined,
        },
      });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    if (user.twoFactorEnabled) {
      if (!input.totp) throw new UnauthorizedException({ code: 'TWO_FACTOR_REQUIRED' });
      const auth = user.authenticators[0];
      if (!auth?.secretCipher) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
      const valid = await verifyTotp(
        { kekId: 'local-master', ciphertext: Buffer.from(auth.secretCipher) },
        input.totp,
      );
      if (!valid) throw new UnauthorizedException({ code: 'TWO_FACTOR_INVALID' });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lastLoginAt: new Date(), lockedUntil: null },
    });

    // Mint the opaque token Auth.js would mint and persist it ourselves.
    const sessionToken = sha256Hex(`${user.id}.${Date.now()}.${meta.ip}`).slice(0, 48);
    const sessionId = await persistSession(sessionToken, user.id, {
      ip: meta.ip,
      userAgent: meta.ua,
      fingerprintHash: meta.fingerprintHash,
      deviceLabel: labelFromUserAgent(meta.ua),
    });

    await this.audit.emit({
      action: 'user.logged_in',
      actor: { kind: 'user', userId: user.id, workspaceId: null },
      targetType: 'session',
      targetId: sessionId,
    });

    return { sessionToken, userId: user.id };
  }

  // ─── 2FA enroll / verify ────────────────────────────────────────────────
  async enroll2fa(userId: string, email: string) {
    const { wrapped, otpauth, qrDataUrl } = await enrollTotp(email);
    const codes = recoveryCodes();
    const hashedCodes = codes.map(sha256Hex);
    const auth = await this.prisma.authenticator.create({
      data: {
        userId,
        kind: 'TOTP',
        label: 'Authenticator app',
        secretCipher: wrapped.ciphertext,
        recoveryCodes: hashedCodes,
      },
    });
    return { authenticatorId: auth.id, otpauth, qrDataUrl, recoveryCodes: codes };
  }

  async confirm2fa(userId: string, authenticatorId: string, code: string) {
    const auth = await this.prisma.authenticator.findFirst({
      where: { id: authenticatorId, userId, kind: 'TOTP' },
    });
    if (!auth?.secretCipher) throw new BadRequestException({ code: 'NOT_FOUND' });
    const valid = await verifyTotp(
      { kekId: 'local-master', ciphertext: Buffer.from(auth.secretCipher) },
      code,
    );
    if (!valid) throw new BadRequestException({ code: 'TOTP_INVALID' });
    await this.prisma.$transaction([
      this.prisma.authenticator.update({
        where: { id: auth.id },
        data: { lastUsedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } }),
    ]);
    await this.audit.emit({
      action: 'user.2fa_enabled',
      actor: { kind: 'user', userId, workspaceId: null },
      targetType: 'user',
      targetId: userId,
    });
  }

  async disable2fa(userId: string) {
    await this.prisma.$transaction([
      this.prisma.authenticator.deleteMany({ where: { userId, kind: 'TOTP' } }),
      this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } }),
    ]);
    await this.audit.emit({
      action: 'user.2fa_disabled',
      actor: { kind: 'user', userId, workspaceId: null },
      targetType: 'user',
      targetId: userId,
    });
  }

  async logoutEverywhere(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'admin' },
    });
    await this.audit.emit({
      action: 'user.logout_all',
      actor: { kind: 'user', userId, workspaceId: null },
    });
  }
}
