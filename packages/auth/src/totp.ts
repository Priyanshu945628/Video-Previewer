/**
 * TOTP (RFC 6238) — encrypted secrets at rest, verified with ±1 step window.
 *
 * Secret bytes are encrypted with the KMS DEK before being stored in
 * authenticators.secretCipher. Only this module decrypts at use time.
 */
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import { kms, type Wrapped } from '@vsp/crypto';

authenticator.options = { window: 1, digits: 6, step: 30 };

export async function enrollTotp(email: string, issuer = 'VSP') {
  const secret = authenticator.generateSecret(20);
  const wrapped = await kms().wrap(Buffer.from(secret, 'utf8'));
  const otpauth = authenticator.keyuri(email, issuer, secret);
  const qrDataUrl = await toDataURL(otpauth);
  return { wrapped, otpauth, qrDataUrl };
}

export async function verifyTotp(wrapped: Wrapped, code: string): Promise<boolean> {
  const secret = (await kms().unwrap(wrapped)).toString('utf8');
  return authenticator.verify({ token: code, secret });
}
