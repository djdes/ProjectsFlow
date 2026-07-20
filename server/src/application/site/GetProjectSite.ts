import { requireProjectAccess } from '../project/projectAccess.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { SiteArtifactRepository } from './SiteArtifactRepository.js';
import type { SiteArtifactStorage } from './SiteArtifactStorage.js';
import { detectProjectRuntime, type ProjectRuntimeSignals } from '../../domain/project/projectRuntimeKind.js';

// Чтение package.json проекта из его репозитория. Порт, потому что источник (GitHub) —
// инфраструктура, а решение «врать ли пользователю про Preview» принимается здесь.
// callerUserId нужен реализации, чтобы взять токен того, кто смотрит: читать чужой
// репозиторий по чужому токену ради подсказки в UI — не то, за что стоит платить.
export type ProjectPackageJsonReader = {
  read(projectId: string, callerUserId: string): Promise<string | null>;
};

// Сайт-результат проекта для владельца/участника (плашка + вкладка «Сайт проекта»). siteSlug
// есть ВСЕГДА (db/100): до деплоя по нему отдаётся заглушка, после — статика. deployedAt/
// fileCount — из site_artifacts (null/0, пока воркер ничего не задеплоил).
export type ProjectSiteInfo = {
  readonly siteSlug: string | null;
  readonly deployedAt: Date | null;
  readonly fileCount: number;
  readonly routes: readonly string[];
  // Вид проекта — заполняется ТОЛЬКО пока сайт не задеплоен. Нужен, чтобы студия не обещала
  // «Preview появится после первого запуска» проекту со своим сервером: запуск не наступит
  // никогда, платформа пользовательский код не исполняет. null = определять не потребовалось.
  readonly runtime: ProjectRuntimeSignals | null;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly sites: SiteArtifactRepository;
  readonly storage: SiteArtifactStorage;
  // Необязателен: без него поведение прежнее (runtime = null), студия просто не показывает
  // объяснение. Так фича не роняет выдачу сайта, если GitHub недоступен или не настроен.
  readonly packageJson?: ProjectPackageJsonReader;
};

export class GetProjectSite {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, callerUserId: string): Promise<ProjectSiteInfo> {
    const { project } = await requireProjectAccess(this.deps, projectId, callerUserId, 'read_project');
    const artifact = await this.deps.sites.getByProject(projectId);
    const routes = artifact
      ? await this.deps.storage.listRoutes(artifact.slug).catch(() => ['/'])
      : ['/'];
    return {
      siteSlug: project.siteSlug,
      deployedAt: artifact?.publishedAt ?? null,
      fileCount: artifact?.fileCount ?? 0,
      routes,
      // Задеплоенный сайт классифицировать незачем — он уже работает. Считаем только для
      // «пустого» превью, то есть ровно там, где студия иначе пообещала бы несбыточное.
      runtime: artifact ? null : await this.detectRuntime(projectId, callerUserId),
    };
  }

  // Best-effort: недоступный GitHub, приватный репозиторий или отозванный токен не должны
  // ломать выдачу сайта — тогда просто нечего сказать про вид проекта.
  private async detectRuntime(projectId: string, callerUserId: string): Promise<ProjectRuntimeSignals | null> {
    if (!this.deps.packageJson) return null;
    try {
      const text = await this.deps.packageJson.read(projectId, callerUserId);
      const signals = detectProjectRuntime(text);
      return signals.kind === 'unknown' ? null : signals;
    } catch {
      return null;
    }
  }
}
