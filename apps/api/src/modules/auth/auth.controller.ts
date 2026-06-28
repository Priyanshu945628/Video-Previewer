import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { LoginInput, SignupInput, EnrollTotpInput, VerifyTotpInput } from '@vsp/contracts';
import { env, isProduction } from '@vsp/config';
import { revokeSession } from '@vsp/auth';
import { Public } from '../../common/guards/public.decorator';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

const cookieName = isProduction ? '__Secure-vsp.session' : 'vsp.session';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @Public()
  @HttpCode(200)
  async signup(@Body(ZodPipe(SignupInput)) body: typeof SignupInput._type, @Req() req: FastifyRequest) {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;
    return this.auth.signup(body, { ip, ua: req.headers['user-agent'] ?? '' });
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body(ZodPipe(LoginInput)) body: typeof LoginInput._type,
    @Req() req: FastifyRequest,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;
    const fingerprint = (req.headers['x-vsp-fingerprint'] as string | undefined) ?? undefined;
    const { sessionToken } = await this.auth.login(body, {
      ip,
      ua: req.headers['user-agent'] ?? '',
      fingerprintHash: fingerprint,
    });
    const res = (req as unknown as { raw: { _vspRes?: { setCookie: (n: string, v: string, o: object) => void } } }).raw;
    // Fastify request.cookies/setCookie is exposed off the reply, but we
    // return the token to the web layer which sets the cookie via Next.
    return { sessionToken, maxAge: env.SESSION_MAX_AGE_SECONDS, cookieName };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() req: FastifyRequest & AuthedRequest) {
    await revokeSession(req.session.token);
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logoutAll(@Req() req: FastifyRequest & AuthedRequest) {
    await this.auth.logoutEverywhere(req.user.id);
  }

  // ─── 2FA ───────────────────────────────────────────────────────────────
  @Post('2fa/enroll')
  @UseGuards(SessionGuard)
  async enroll(@Req() req: FastifyRequest & AuthedRequest, @Body(ZodPipe(EnrollTotpInput)) _body: typeof EnrollTotpInput._type) {
    return this.auth.enroll2fa(req.user.id, req.user.email);
  }

  @Post('2fa/confirm')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async confirm(
    @Req() req: FastifyRequest & AuthedRequest,
    @Body(ZodPipe(VerifyTotpInput)) body: typeof VerifyTotpInput._type,
  ) {
    await this.auth.confirm2fa(req.user.id, body.secretId, body.code);
  }

  @Post('2fa/disable')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async disable(@Req() req: FastifyRequest & AuthedRequest) {
    await this.auth.disable2fa(req.user.id);
  }
}
