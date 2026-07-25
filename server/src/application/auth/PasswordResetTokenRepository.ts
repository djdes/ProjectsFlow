// Порт хранилища токенов сброса пароля. Реализация (Drizzle) сама хэширует plaintext-токен
// (SHA-256) на записи и при поиске — application-слой оперирует только plaintext'ом.
export type PasswordResetTokenLookup = {
  readonly id: string;
  readonly userId: string;
};

export interface PasswordResetTokenRepository {
  create(input: {
    readonly id: string;
    readonly userId: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void>;
  /**
   * Вернуть валидный (не использованный и не истёкший на `now`) токен по plaintext'у,
   * либо null. Реализация ищет по SHA-256(token).
   */
  findValidByToken(token: string, now: Date): Promise<PasswordResetTokenLookup | null>;
  markUsed(id: string, at: Date): Promise<void>;
  // Инвалидация всех прежних токенов юзера — при новом запросе и после успешного сброса.
  deleteAllForUser(userId: string): Promise<void>;
}
