export type StoredSecret = {
  readonly id: string;
  readonly userId: string;
  readonly secretKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export interface SecretsRepository {
  upsert(userId: string, key: string, value: string): Promise<void>;
  getValue(userId: string, key: string): Promise<string | null>;
  delete(userId: string, key: string): Promise<boolean>;
  listKeys(userId: string): Promise<StoredSecret[]>;
}
