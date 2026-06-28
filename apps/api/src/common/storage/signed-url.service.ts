import { Injectable } from '@nestjs/common';
import {
  issueSignedToken,
  verifySignedToken,
  type SignedResource,
  type SignedPayload,
  type SignedToken,
} from '@vsp/crypto';
import { env } from '@vsp/config';
import { RedisService } from '../redis/redis.service';

/**
 * Thin wrapper around @vsp/crypto's signed token primitives, layered with
 * Redis-backed single-use nonce enforcement for one-shot resources
 * (download URLs in particular).
 */
@Injectable()
export class SignedUrlService {
  constructor(private readonly redis: RedisService) {}

  /** Mint a signed token. Use shorter ttl for downloads (60s) and AES keys. */
  issue(params: {
    sub: string;
    res: SignedResource;
    params?: Record<string, string | number>;
    ttlSeconds?: number;
  }): SignedToken {
    return issueSignedToken({
      sub: params.sub,
      res: params.res,
      params: params.params,
      ttlSeconds: params.ttlSeconds ?? env.SIGNED_URL_TTL_SECONDS,
    });
  }

  /** Verify a token against the expected resource + subject. */
  verify(
    token: string,
    expected: { res: SignedResource; sub?: string },
  ): { ok: true; payload: SignedPayload } | { ok: false; reason: string } {
    const r = verifySignedToken(token);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (r.payload.res !== expected.res) return { ok: false, reason: 'res_mismatch' };
    if (expected.sub && r.payload.sub !== expected.sub) return { ok: false, reason: 'sub_mismatch' };
    return r;
  }

  /** Consume the token's jti — true on first use, false on replay/expiry. */
  async consume(payload: SignedPayload): Promise<boolean> {
    const ttl = Math.max(1, payload.exp - Math.floor(Date.now() / 1000) + 60);
    return this.redis.consumeNonce(payload.jti, ttl);
  }
}
