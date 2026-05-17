import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbDocumentNotFoundError, KbNotConnectedError } from '../../domain/kb/errors.js';
import {
  GithubNotConnectedError,
  GithubRepoUrlInvalidError,
} from '../../domain/github/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { KbRepository } from '../kb/KbRepository.js';
import type { GetSecret } from '../secrets/GetSecret.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
  readonly getSecret: GetSecret;
};

// Результат для агента: ВСЕ поля credential'а уже в plaintext (vault://-рефы резолвнуты).
// `type`/`title`/`kind` идут как meta. Остальное — в fields.
export type ResolvedCredential = {
  readonly title: string;
  readonly kind: string | null;
  readonly fields: Readonly<Record<string, string>>;
};

const VAULT_RE = /^vault:\/\/([a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+)$/;
const REF_SUFFIX = '_ref';
const META_KEYS = new Set(['type', 'title', 'kind']);

// Достаёт credential-файл из KB-репо проекта и резолвит все `*_ref: vault://...` поля
// в plaintext'ы через GetSecret use-case. Возвращает плоский объект {fieldName: value}.
//
// Используется только agent-endpoint'ами — обычный user-flow читает frontmatter с
// vault-рефами и резолвит секреты ЛЕНИВО в UI (через GET /api/secrets?key=...).
export class GetAgentCredential {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, slug: string): Promise<ResolvedCredential> {
    const project = await this.deps.projects.getByIdForOwner(projectId, userId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    const token = await this.deps.tokens.getWithTokenByUserId(userId);
    if (!token) throw new GithubNotConnectedError();

    const path = `credentials/${slug}.md`;
    const doc = await this.deps.kb.readOne({
      accessToken: token.accessToken,
      fullName: project.kbRepoFullName,
      path,
    });
    if (!doc) throw new KbDocumentNotFoundError(path);

    const fm = doc.frontmatter as Record<string, unknown>;
    const title = typeof fm['title'] === 'string' ? fm['title'] : slug;
    const kind = typeof fm['kind'] === 'string' ? fm['kind'] : null;

    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(fm)) {
      if (META_KEYS.has(key)) continue;
      if (typeof value !== 'string') continue;
      // `*_ref` → vault-резолв
      if (key.endsWith(REF_SUFFIX)) {
        const match = VAULT_RE.exec(value);
        if (!match) {
          // Ref-значение не выглядит как vault://… — пропускаем (или можно throw'ить
          // KbInvalidRefError; для агента — лучше пропустить чтобы не падать на одном
          // битом поле).
          continue;
        }
        const plain = await this.deps.getSecret.execute(userId, match[1]!);
        const fieldName = key.slice(0, -REF_SUFFIX.length);
        fields[fieldName] = plain;
      } else {
        fields[key] = value;
      }
    }

    // Если URL git-repo указан там же — также прокидываем для удобства.
    if (!('repo' in fields) && project.gitRepoUrl) {
      fields['repo'] = project.gitRepoUrl;
    }
    if (!('project_name' in fields)) {
      fields['project_name'] = project.name;
    }
    if (!('project_slug' in fields)) {
      fields['project_slug'] = slug;
    }

    return { title, kind, fields };
  }
}
