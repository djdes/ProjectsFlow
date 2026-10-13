export type TelegramPairingResult = 'connected' | 'expired' | 'already_linked';

export interface TelegramPairingRepository {
  /** Replaces the previous pending link for this user. Stores only a SHA-256 hash. */
  issue(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<boolean>;
  /** Validates and consumes the token and binds the private chat in one transaction. */
  complete(input: {
    tokenHash: string;
    telegramUserId: number;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    now: Date;
  }): Promise<TelegramPairingResult>;
  revoke(userId: string): Promise<void>;
}
