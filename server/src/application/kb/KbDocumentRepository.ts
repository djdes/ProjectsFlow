// Хранилище документов локальной KB (kb_kind='local'). Только сырьё: path + content + sha.
// Парсинг frontmatter и валидация — в LocalKbBackend.

export type KbDocumentRecord = {
  readonly path: string;
  readonly content: string;
  readonly sha: string;
};

export type UpsertKbDocumentInput = {
  readonly id: string;
  readonly projectId: string;
  readonly path: string;
  readonly content: string;
  readonly sha: string;
};

export interface KbDocumentRepository {
  listByProject(projectId: string): Promise<KbDocumentRecord[]>;
  getByPath(projectId: string, path: string): Promise<KbDocumentRecord | null>;
  upsert(input: UpsertKbDocumentInput): Promise<void>;
  deleteByPath(projectId: string, path: string): Promise<void>;
}
