import type { GithubApiClient } from '../../application/github/GithubApiClient.js';
import type { GithubTokenRepository } from '../../application/github/GithubTokenRepository.js';
import { parseGithubOwnerRepo } from '../../application/github/ListProjectCommits.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import type { ProjectPackageJsonReader } from '../../application/site/GetProjectSite.js';

/**
 * Читает `package.json` проекта из его GitHub-репозитория — чтобы студия могла честно
 * сказать «этот проект здесь не запустится», а не обещать Preview, которого не будет.
 *
 * Сознательные ограничения:
 *
 * 1. **Только собственный токен смотрящего.** Делегированные токены участников платформа
 *    выдаёт под аудит (`GitTokenAccessContext`), и правильно: занимать чужой доступ ради
 *    подсказки в интерфейсе — не тот размен. Нет своего токена → вернём null → студия
 *    ведёт себя как раньше.
 * 2. **Ошибки гасятся в null.** Единственный потребитель — подсказка в пустом превью;
 *    уронить из-за неё выдачу сайта нельзя.
 * 3. **Короткий TTL-кэш.** Превью запрашивает сайт при каждом открытии вкладки, а
 *    `package.json` меняется раз в месяц. Без кэша это лишний round-trip к GitHub на
 *    каждый показ.
 */

const TTL_MS = 5 * 60 * 1000;
// Кэш живёт в памяти процесса и чистится лениво. Потолок — чтобы длинная сессия с сотнями
// проектов не превратила подсказку в утечку.
const MAX_ENTRIES = 500;

type Entry = { readonly text: string | null; readonly expiresAt: number };

type Deps = {
  readonly projects: Pick<ProjectRepository, 'getById'>;
  readonly tokens: Pick<GithubTokenRepository, 'getWithTokenByUserId'>;
  readonly api: Pick<GithubApiClient, 'getRepoFile'>;
  readonly now?: () => number;
};

export class GithubProjectPackageJsonReader implements ProjectPackageJsonReader {
  private readonly cache = new Map<string, Entry>();

  constructor(private readonly deps: Deps) {}

  async read(projectId: string, callerUserId: string): Promise<string | null> {
    const now = this.deps.now ? this.deps.now() : Date.now();
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > now) return cached.text;

    const text = await this.fetch(projectId, callerUserId);
    this.remember(projectId, text, now);
    return text;
  }

  private async fetch(projectId: string, callerUserId: string): Promise<string | null> {
    const project = await this.deps.projects.getById(projectId);
    if (!project?.gitRepoUrl) return null;

    const parsed = parseGithubOwnerRepo(project.gitRepoUrl);
    if (!parsed) return null;

    const connection = await this.deps.tokens.getWithTokenByUserId(callerUserId);
    if (!connection) return null;

    const file = await this.deps.api.getRepoFile(
      connection.accessToken,
      `${parsed.owner}/${parsed.repo}`,
      'package.json',
    );
    return file?.content ?? null;
  }

  private remember(projectId: string, text: string | null, now: number): void {
    if (this.cache.size >= MAX_ENTRIES) {
      for (const [key, entry] of this.cache) {
        if (entry.expiresAt <= now) this.cache.delete(key);
      }
      // Всё ещё полон — значит записи живые; жертвуем самой старой (Map хранит порядок вставки).
      if (this.cache.size >= MAX_ENTRIES) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
    }
    this.cache.set(projectId, { text, expiresAt: now + TTL_MS });
  }
}
