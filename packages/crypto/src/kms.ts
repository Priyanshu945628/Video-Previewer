/**
 * KMS abstraction — wraps + unwraps per-asset Data Encryption Keys (DEKs)
 * with a Key Encryption Key (KEK).
 *
 *   - local: AES-256-GCM with a static master key (DEV ONLY)
 *   - aws  : AWS KMS Encrypt/Decrypt on the configured key id
 *
 * Production MUST set KMS_PROVIDER=aws. The config loader enforces this.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { env } from '@vsp/config';
import { createLogger } from '@vsp/logger';

const log = createLogger('crypto.kms');

export type KekId = string; // identifier of the KEK that wrapped the DEK
export type Wrapped = { kekId: KekId; ciphertext: Buffer };

export interface Kms {
  /** Generate a fresh DEK and return both plaintext + wrapped form. */
  generateDek(): Promise<{ plaintext: Buffer; wrapped: Wrapped }>;
  /** Wrap an externally-generated DEK. */
  wrap(plaintext: Buffer): Promise<Wrapped>;
  /** Unwrap a stored DEK. */
  unwrap(wrapped: Wrapped): Promise<Buffer>;
}

// ─── Local provider — AES-256-GCM with one static master key ────────────────
class LocalKms implements Kms {
  private readonly kek: Buffer;
  private readonly kekId: KekId = 'local-master';

  constructor() {
    if (!env.KMS_LOCAL_MASTER_KEY) throw new Error('KMS_LOCAL_MASTER_KEY required for local provider');
    this.kek = Buffer.from(env.KMS_LOCAL_MASTER_KEY, 'base64');
    if (this.kek.length < 32) throw new Error('KMS_LOCAL_MASTER_KEY must decode to ≥32 bytes');
  }

  async generateDek() {
    const plaintext = randomBytes(16); // AES-128 for HLS
    const wrapped = await this.wrap(plaintext);
    return { plaintext, wrapped };
  }

  async wrap(plaintext: Buffer): Promise<Wrapped> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.kek, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // layout: [iv(12)][tag(16)][ct]
    return { kekId: this.kekId, ciphertext: Buffer.concat([iv, tag, ct]) };
  }

  async unwrap(wrapped: Wrapped): Promise<Buffer> {
    if (wrapped.kekId !== this.kekId) throw new Error(`unknown kekId ${wrapped.kekId}`);
    const iv = wrapped.ciphertext.subarray(0, 12);
    const tag = wrapped.ciphertext.subarray(12, 28);
    const ct = wrapped.ciphertext.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}

// ─── AWS KMS provider ────────────────────────────────────────────────────────
class AwsKms implements Kms {
  private readonly client: KMSClient;
  private readonly keyId: KekId;

  constructor() {
    if (!env.KMS_KEY_ID) throw new Error('KMS_KEY_ID required for aws provider');
    this.keyId = env.KMS_KEY_ID;
    this.client = new KMSClient({ region: env.AWS_REGION });
  }

  async generateDek() {
    const plaintext = randomBytes(16);
    const wrapped = await this.wrap(plaintext);
    return { plaintext, wrapped };
  }

  async wrap(plaintext: Buffer): Promise<Wrapped> {
    const r = await this.client.send(
      new EncryptCommand({ KeyId: this.keyId, Plaintext: plaintext }),
    );
    if (!r.CiphertextBlob) throw new Error('KMS returned empty ciphertext');
    return { kekId: this.keyId, ciphertext: Buffer.from(r.CiphertextBlob) };
  }

  async unwrap(wrapped: Wrapped): Promise<Buffer> {
    const r = await this.client.send(new DecryptCommand({ CiphertextBlob: wrapped.ciphertext }));
    if (!r.Plaintext) throw new Error('KMS returned empty plaintext');
    return Buffer.from(r.Plaintext);
  }
}

let _kms: Kms | null = null;

export function kms(): Kms {
  if (_kms) return _kms;
  switch (env.KMS_PROVIDER) {
    case 'aws':
      log.info('initializing AWS KMS provider');
      _kms = new AwsKms();
      break;
    case 'local':
      log.warn('initializing LOCAL KMS provider — development only');
      _kms = new LocalKms();
      break;
    case 'vault':
      throw new Error('Vault provider not yet implemented');
    default:
      throw new Error(`unknown KMS provider: ${env.KMS_PROVIDER}`);
  }
  return _kms;
}
