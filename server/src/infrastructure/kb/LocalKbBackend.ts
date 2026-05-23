import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { KbDocumentNotFoundError, KbRepoConflictError } from '../../domain/kb/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type { KbDocumentRepository } from '../../application/kb/KbDocumentRepository.js';
import { validateFrontmatter } from '../../application/kb/FrontmatterValidator.js';
import type {
  KbDeleteInput,
  KbWriteInput,
  ProjectKbStore,
} from '../../application/kb/ProjectKbStore.js';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function parseDoc(path: string, content: string, sha: string): KbDocument {
  const m = matter(content);
  const fm = m.data as Frontmatter;
  return {
    path,
    frontmatter: fm,
    body: m.content,
    raw: content,
    sha,
    validationErrors: validateFrontmatter(fm, m.content),
  };
}

// local-бэкенд KB: документы хранятся в БД (таблица kb_documents). sha = sha256(content).
export class LocalKbBackend implements ProjectKbStore {
  constructor(
    private readonly deps: { docs: KbDocumentRepository; idGen: () => string },
  ) {}

  // _actorUserId везде игнорируем — local KB не нуждается в GitHub-токене.
  // Параметр в сигнатуре только для совместимости с ProjectKbStore (см. v0.16).
  async list(project: Project, _actorUserId?: string): Promise<KbDocumentSummary[]> {
    const recs = await this.deps.docs.listByProject(project.id);
    return recs.map((r) => {
      const m = matter(r.content);
      const fm = m.data as Frontmatter;
      return {
        path: r.path,
        frontmatter: fm,
        sha: r.sha,
        validationErrors: validateFrontmatter(fm, m.content),
      };
    });
  }

  async read(project: Project, path: string, _actorUserId?: string): Promise<KbDocument | null> {
    const r = await this.deps.docs.getByPath(project.id, path);
    return r ? parseDoc(path, r.content, r.sha) : null;
  }

  async write(project: Project, input: KbWriteInput, _actorUserId?: string): Promise<{ sha: string }> {
    const existing = await this.deps.docs.getByPath(project.id, input.path);
    // Optimistic-lock: если клиент прислал sha (update) и он не совпал с текущим — конфликт.
    if (input.sha && existing && existing.sha !== input.sha) {
      throw new KbRepoConflictError();
    }
    const sha = sha256(input.content);
    await this.deps.docs.upsert({
      id: this.deps.idGen(),
      projectId: project.id,
      path: input.path,
      content: input.content,
      sha,
    });
    return { sha };
  }

  async delete(project: Project, input: KbDeleteInput, _actorUserId?: string): Promise<void> {
    const existing = await this.deps.docs.getByPath(project.id, input.path);
    if (!existing) throw new KbDocumentNotFoundError(input.path);
    await this.deps.docs.deleteByPath(project.id, input.path);
  }
}
