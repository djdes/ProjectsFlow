export type StoredSecret = {
  readonly id: string;
  readonly projectId: string | null;
  readonly secretKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

// Секреты scope'аются по проекту: один набор на проект, виден всем участникам.
// byUserId сохраняется как audit (кто записал), но в ключ доступа не входит.
export interface SecretsRepository {
  upsert(projectId: string, key: string, value: string, byUserId: string): Promise<void>;
  getValue(projectId: string, key: string): Promise<string | null>;
  delete(projectId: string, key: string): Promise<boolean>;
  listKeys(projectId: string): Promise<StoredSecret[]>;
}
