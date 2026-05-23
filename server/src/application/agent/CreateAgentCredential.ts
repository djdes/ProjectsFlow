import matter from 'gray-matter';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { ProjectKbStore } from '../kb/ProjectKbStore.js';
import type { SecretsRepository } from '../secrets/SecretsRepository.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import { validateFrontmatter } from '../kb/FrontmatterValidator.js';
import { slugify } from '../kb/BulkCreateCredential.js';
import { FrontmatterInvalidError, KbNotConnectedError } from '../../domain/kb/errors.js';

// Agent-facing создание credential'а. В отличие от UI-flow (BulkCreateCredential
// принимает env-style rawText и эвристически угадывает что secret), здесь агент
// передаёт structured fields с явным флагом isSecret — это однозначно и не зависит
// от имени поля.
//
// Контракт: каждое поле либо публичное (живёт в frontmatter как key: value), либо
// секретное (в frontmatter — key_ref: vault://..., значение — в secrets-таблице).

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly kb: ProjectKbStore;
  readonly secrets: SecretsRepository;
};

export type AgentCredentialField = {
  readonly key: string;
  readonly value: string;
  readonly isSecret: boolean;
};

export type CreateAgentCredentialCommand = {
  readonly projectId: string;
  readonly userId: string;
  readonly title: string;
  // kind свободной формы — лежит в frontmatter.kind как есть (lowercase обычно:
  // 'npm-token', 'ssh', 'github-pat' и т.п.). UI рисует бейдж по этому полю.
  readonly kind: string | null;
  readonly fields: readonly AgentCredentialField[];
  // Опционально: явный slug файла. По умолчанию — slugify(title).
  readonly slug: string | null;
};

export type CreateAgentCredentialResult = {
  readonly path: string;
  readonly slug: string;
  readonly sha: string;
  readonly secretsWritten: readonly string[];
};

export class CreateAgentCredential {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateAgentCredentialCommand): Promise<CreateAgentCredentialResult> {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new FrontmatterInvalidError([
        { code: 'title_missing', message: 'title не может быть пустым' },
      ]);
    }

    const { project } = await requireProjectAccess(this.deps, input.projectId, input.userId, 'manage_kb');
    if (project.kbKind === 'none') throw new KbNotConnectedError();

    const projectSlug = slugify(project.name);
    const fileSlug = (input.slug?.trim() || slugify(title)) ?? '';
    if (fileSlug.length === 0) {
      throw new FrontmatterInvalidError([
        { code: 'slug_invalid', message: 'Не получилось сделать slug — укажи slug явно' },
      ]);
    }

    const fm: Record<string, unknown> = { type: 'credential', title };
    if (input.kind && input.kind.trim().length > 0) fm['kind'] = input.kind.trim();

    const secretsToWrite: Array<{ key: string; value: string }> = [];
    for (const f of input.fields) {
      const key = f.key.trim();
      if (key.length === 0) continue;
      if (f.isSecret) {
        const vaultKey = `${projectSlug}/${fileSlug}/${key}`;
        fm[`${key}_ref`] = `vault://${vaultKey}`;
        secretsToWrite.push({ key: vaultKey, value: f.value });
      } else {
        fm[key] = f.value;
      }
    }

    const errors = validateFrontmatter(fm as Frontmatter, '');
    if (errors.length > 0) throw new FrontmatterInvalidError(errors);

    // Секреты — первыми, чтобы не оставить файл с висящими vault-ref'ами при сбое.
    // Scope — проект: креды общие для всех участников. input.userId идёт как audit.
    for (const s of secretsToWrite) {
      await this.deps.secrets.upsert(project.id, s.key, s.value, input.userId);
    }

    // Markdown-документ в KB (github или local — решает DispatchingKbStore).
    const content = matter.stringify('', fm);
    const path = `credentials/${fileSlug}.md`;
    const { sha } = await this.deps.kb.write(
      project,
      {
        path,
        content,
        message: `chore(kb): create credential ${fileSlug} via agent`,
        sha: null,
      },
      input.userId,
    );

    return { path, slug: fileSlug, sha, secretsWritten: secretsToWrite.map((s) => s.key) };
  }
}
