import type { SecretsCipher } from './SecretsCipher.js';

export type StoredSecret = {
  readonly id: string;
  readonly userId: string;
  readonly secretKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export interface SecretsRepository {
  // Шифрование делается ВНУТРИ репо через переданный cipher.
  upsert(userId: string, key: string, value: string, cipher: SecretsCipher): Promise<void>;
  // Возвращает расшифрованное значение или null.
  getValue(userId: string, key: string, cipher: SecretsCipher): Promise<string | null>;
  delete(userId: string, key: string): Promise<boolean>;
  listKeys(userId: string): Promise<StoredSecret[]>;
}
