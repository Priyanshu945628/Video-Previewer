import { describe, it, expect } from 'vitest';
import { sha256Hex, sha256B64u, constantTimeEqual } from './hashing';

describe('hashing', () => {
  it('sha256 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a3396177a9cb410ff61f20015a');
  });

  it('b64u has no padding', () => {
    expect(sha256B64u('abc')).not.toMatch(/=/);
  });

  it('constantTimeEqual is correct', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false); // length mismatch
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
