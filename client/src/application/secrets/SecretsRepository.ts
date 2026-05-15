export type StoredSecretKey = {
  readonly key: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export interface SecretsRepository {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  list(): Promise<StoredSecretKey[]>;
}
