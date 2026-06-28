/**
 * Canonical Redis keys for auth-related rate limits.
 * Centralised so the API and Auth.js callbacks agree on the same buckets.
 */
export const rlKey = {
  login: (email: string, ip: string) => `rl:login:${email.toLowerCase()}:${ip}`,
  totp: (userId: string) => `rl:totp:${userId}`,
  magic: (email: string) => `rl:magic:${email.toLowerCase()}`,
  signup: (ip: string) => `rl:signup:${ip}`,
  streamKey: (userId: string) => `rl:streamkey:${userId}`,
  download: (userId: string) => `rl:download:${userId}`,
};
