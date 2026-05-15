import argon2 from 'argon2';
import type { PasswordHasher } from '../../application/crypto/PasswordHasher.js';

// Параметры argon2id согласно OWASP-рекомендациям 2024.
// memoryCost — в KiB; 64 MiB — стандарт. timeCost=3 итерации, parallelism=4.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      // argon2.verify не принимает hash-параметры — они зашиты в самой hash-строке.
      return await argon2.verify(hash, plain);
    } catch {
      // Невалидный hash-формат → не пара
      return false;
    }
  }
}
