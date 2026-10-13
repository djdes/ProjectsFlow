import { createHash, randomBytes } from 'node:crypto';
import type { TelegramPairingRepository, TelegramPairingResult } from './TelegramPairingRepository.js';

export class TelegramPairingUnavailableError extends Error {}
export class TelegramAccountConnectedError extends Error {}

export type TelegramPairingDto = { url: string; expiresAt: string };
const TTL_MS = 10 * 60 * 1000;
const PREFIX = 'connect_';
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

export class PairTelegramAccount {
  constructor(private readonly deps: {
    repository: TelegramPairingRepository;
    botUsername: string | null;
    enabled: boolean;
    now?: () => Date;
  }) {}

  async start(userId: string): Promise<TelegramPairingDto> {
    const username = this.deps.botUsername?.replace(/^@/, '');
    if (!this.deps.enabled || !username || !/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new TelegramPairingUnavailableError();
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + TTL_MS);
    const issued = await this.deps.repository.issue({ userId, tokenHash: hash(token), expiresAt });
    if (!issued) throw new TelegramAccountConnectedError();
    return { url: `https://t.me/${username}?start=${PREFIX}${token}`, expiresAt: expiresAt.toISOString() };
  }

  async complete(input: {
    payload: string;
    chatType: string;
    chatId: number;
    from: { id: number; username?: string; first_name?: string };
  }): Promise<TelegramPairingResult> {
    // Only Telegram's authenticated private-chat update can redeem a link, never an HTTP body
    // containing a claimed Telegram user id, a group message, or an inline callback.
    if (input.chatType !== 'private' || input.chatId !== input.from.id ||
        !Number.isSafeInteger(input.from.id) || input.from.id <= 0 ||
        !/^connect_[A-Za-z0-9_-]{43}$/.test(input.payload)) return 'expired';
    return this.deps.repository.complete({
      tokenHash: hash(input.payload.slice(PREFIX.length)),
      telegramUserId: input.from.id,
      telegramUsername: input.from.username?.slice(0, 64) ?? null,
      telegramFirstName: input.from.first_name?.slice(0, 128) ?? null,
      now: this.now(),
    });
  }

  revoke(userId: string): Promise<void> { return this.deps.repository.revoke(userId); }
  private now(): Date { return this.deps.now?.() ?? new Date(); }
}
