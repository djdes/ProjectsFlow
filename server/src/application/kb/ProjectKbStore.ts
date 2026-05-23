import type { Project } from '../../domain/project/Project.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';

// Project-центрированный фасад над KB. Реализация (DispatchingKbStore) сама выбирает
// бэкенд по project.kbKind (github / local) и достаёт github-токен при необходимости —
// use-case'ам это знать не нужно.
//
// v0.16+: каждый метод принимает `actorUserId`. GithubKbBackend использует его
// в resolveEffectiveGithubToken (caller's own → fallback на делегированный).
// LocalKbBackend actor игнорирует — local KB не нуждается в GitHub-токене.
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
  list(project: Project, actorUserId: string): Promise<KbDocumentSummary[]>;
  read(project: Project, path: string, actorUserId: string): Promise<KbDocument | null>;
  write(project: Project, input: KbWriteInput, actorUserId: string): Promise<{ sha: string }>;
  delete(project: Project, input: KbDeleteInput, actorUserId: string): Promise<void>;
}
