import type { Project } from '../../domain/project/Project.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';

// Project-центрированный фасад над KB. Реализация (DispatchingKbStore) сама выбирает
// бэкенд по project.kbKind (github / local) и достаёт github-токен при необходимости —
// use-case'ам это знать не нужно.
export type KbWriteInput = {
  readonly path: string;
  readonly content: string; // готовый md (frontmatter+body)
  readonly message: string;
  readonly sha: string | null;
};

export type KbDeleteInput = {
  readonly path: string;
  readonly sha: string;
  readonly message: string;
};

export interface ProjectKbStore {
  list(project: Project): Promise<KbDocumentSummary[]>;
  read(project: Project, path: string): Promise<KbDocument | null>;
  write(project: Project, input: KbWriteInput): Promise<{ sha: string }>;
  delete(project: Project, input: KbDeleteInput): Promise<void>;
}
