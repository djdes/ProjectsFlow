export type StoredSecretKey = {
  readonly key: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

// Секреты scope'аются по проекту — все методы принимают projectId.
export interface SecretsRepository {
  put(projectId: string, key: string, value: string): Promise<void>;
  get(projectId: string, key: string): Promise<string>;
  delete(projectId: string, key: string): Promise<void>;
  list(projectId: string): Promise<StoredSecretKey[]>;
}
