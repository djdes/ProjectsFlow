import { randomBytes } from 'node:crypto';
import type { AgentDeviceCodeStore } from './AgentDeviceCodeStore.js';

type Deps = {
  readonly store: AgentDeviceCodeStore;
  readonly now: () => Date;
  readonly ttlMs: number;
  readonly intervalSec: number;
  readonly verificationBaseUrl: string;
};

export type RequestAgentDeviceCodeResult = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly expiresIn: number;
  readonly interval: number;
};

// Алфавит для user-code'а: без визуально-неоднозначных 0/O/1/I/L/U.
// 28 символов × 8 = ~38 бит энтропии. Достаточно для 10-минутного окна
// (rate-limit на брутфорс мог бы быть, но atm нет — at-most-once attempt
// per user_code тоже работает: после неверного approve просто 404).
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const USER_CODE_LEN = 8;

function generateUserCode(): string {
  const bytes = randomBytes(USER_CODE_LEN);
  let out = '';
  for (let i = 0; i < USER_CODE_LEN; i++) {
    out += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length];
  }
  // Форматируем "ABCD-1234" для удобства ручного ввода.
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function generateDeviceCode(): string {
  // 32 байта = 256-bit, base64url ~43 chars.
  return randomBytes(32).toString('base64url');
}

export class RequestAgentDeviceCode {
  constructor(private readonly deps: Deps) {}

  execute(): RequestAgentDeviceCodeResult {
    const now = this.deps.now();
    const expiresAt = new Date(now.getTime() + this.deps.ttlMs);

    // Пытаемся избежать user_code-collision (вероятность мизерная при 28^8, но защита дешёвая).
    let userCode = generateUserCode();
    for (let i = 0; i < 5 && this.deps.store.getByUserCode(userCode); i++) {
      userCode = generateUserCode();
    }

    const deviceCode = generateDeviceCode();
    this.deps.store.create({ deviceCode, userCode, expiresAt, now });

    const base = this.deps.verificationBaseUrl.replace(/\/+$/, '');
    const verificationUri = `${base}/device`;
    // Полный URL с встроенным кодом — лендингу удобнее в QR/ссылках.
    const verificationUriComplete = `${verificationUri}?code=${encodeURIComponent(userCode)}`;

    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete,
      expiresIn: Math.floor(this.deps.ttlMs / 1000),
      interval: this.deps.intervalSec,
    };
  }
}
