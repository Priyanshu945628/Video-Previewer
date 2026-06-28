/**
 * Password hashing — Argon2id with OWASP-recommended cost.
 * Tuned for ~250ms on a modern server CPU.
 */
import { hash, verify, argon2id } from 'argon2';

const OPTS = {
  type: argon2id,
  memoryCost: 19 * 1024, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTS);
}

export async function verifyPassword(plaintext: string, digest: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext, OPTS);
  } catch {
    return false;
  }
}
