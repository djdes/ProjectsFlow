import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
};

// Транслит кириллицы → латиница, чтобы имя репо было читаемым для русских названий
// (InitKbRepo этого не делает и превращает «Обувь» в «project»).
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function slugify(name: string): string {
  const translit = name
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('');
  return (
    translit
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  );
}

// GitHub возвращает 422 когда имя репо уже занято у пользователя.
function isNameTaken(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 422;
}

// Создать (или вернуть существующий) GitHub-репо приложения проекта — куда self-serve воркер
// будет писать код. Owner-only. Репо создаётся под аккаунтом ВЛАДЕЛЬЦА его OAuth-токеном (как KB),
// приватный, с авто-README (нужна ветка main для будущего workflow_dispatch). Идемпотентно:
// если у проекта уже есть app_repo_full_name — возвращаем его; если имя занято (422) — reuse.
export class EnsureProjectAppRepo {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, callerUserId: string): Promise<{ fullName: string }> {
    const { project } = await requireProjectAccess(
      this.deps,
      projectId,
      callerUserId,
      'manage_app_repo',
    );

    if (project.appRepoFullName) return { fullName: project.appRepoFullName };

    const token = await this.deps.tokens.getWithTokenByUserId(project.ownerId);
    if (!token) throw new GithubNotConnectedError();

    // Короткий id проекта в имени гарантирует уникальность (два проекта с одинаковым названием
    // не столкнутся) и делает 422-reuse корректным (422 = повторный прогон ЭТОГО проекта).
    const repoName = `pf-${slugify(project.name)}-${project.id.slice(0, 8)}`;
    let fullName: string;
    try {
      const result = await this.deps.api.createRepo(token.accessToken, {
        name: repoName,
        description: `ProjectsFlow app for ${project.name}`,
        privateRepo: true,
        autoInit: true,
      });
      fullName = result.fullName;
    } catch (err) {
      if (!isNameTaken(err)) throw err;
      // Имя уже занято у владельца → считаем это тем же app-репо (идемпотентно).
      const me = await this.deps.api.getAuthenticatedUser(token.accessToken);
      fullName = `${me.login}/${repoName}`;
    }

    // gitRepoUrl проставляем на app-репо (если ещё не задан), чтобы диспетчер клонировал именно
    // его существующим git-флоу. Не перезатираем уже подключённый пользователем репо.
    await this.deps.projects.update(projectId, {
      appRepoFullName: fullName,
      ...(project.gitRepoUrl ? {} : { gitRepoUrl: `https://github.com/${fullName}` }),
    });
    return { fullName };
  }
}
