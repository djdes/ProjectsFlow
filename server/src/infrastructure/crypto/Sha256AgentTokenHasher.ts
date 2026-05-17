import { createHash, timingSafeEqual } from 'node:crypto';
import type { AgentTokenHasher } from '../../application/agent/AgentTokenHasher.js';

// SHA-256 для agent-токенов. Plaintext-токены — crypto-random 32 байта (full entropy),
// поэтому slow-KDF (argon2) не нужен. SHA-256 deterministic → можно искать по hash в БД.
//
// Защита от timing-attack'ов на verify через timingSafeEqual.
export class Sha256AgentTokenHasher implements AgentTokenHasher {
  async hash(plaintext: string): Promise<string> {
    return createHash('sha256').update(plaintext, 'utf8').digest('hex');
  }

  async verify(plaintext: string, expectedHash: string): Promise<boolean> {
    const actual = createHash('sha256').update(plaintext, 'utf8').digest();
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
