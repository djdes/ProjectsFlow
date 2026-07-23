import type { CommitSyncJob } from '../../domain/commit-sync/CommitSyncJob.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';
import { defaultAutomationConfig } from '../automation/criteria.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { ListProjectCommits } from '../github/ListProjectCommits.js';
import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';
import {
  commitReviewWindowHours,
  prepareCommitSyncContext,
} from './prepareCommitSyncContext.js';

// Сколько коммитов отдаём модели на сопоставление (свежие сверху). Хватает покрыть
// несколько дней активности; ranних коммитов для старых задач достаточно для done-перехода.
const COMMIT_FETCH_LIMIT = 100;

type Deps = {
  readonly projects: ProjectRepository;
  readonly automation: AutomationRepository;
  readonly tasks: TaskRepository;
  readonly listProjectCommits: ListProjectCommits;
  readonly commitSyncJobs: CommitSyncJobRepository;
  readonly tokens: Pick<GithubTokenRepository, 'getByUserId'>;
};

// Системный путь (вызывает планировщик): ставит commit-sync job для проекта.
// Возвращает null если делать нечего: нет диспетчера / выключено /
// уже есть активный job / нет GitHub-доступа. Пустой репозиторий всё равно
// создаёт job, чтобы в 17:00 пришёл честный итог «за период коммитов нет».
// Планировщик в любом
// случае пометит прогон (markCommitSyncRun) — чтобы не ретраить каждую минуту.
export class EnqueueCommitSyncJob {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    now: Date = new Date(),
    opts: { forceEnabled?: boolean } = {},
  ): Promise<CommitSyncJob | null> {
    const project = await this.deps.projects.getById(projectId);
    if (!project?.dispatcherUserId) return null;
    const dispatcherUserId = project.dispatcherUserId;

    const config = (await this.deps.automation.getConfig(projectId)) ?? defaultAutomationConfig(projectId);
    if (!config.commitSyncEnabled && !opts.forceEnabled) return null;

    // Дедуп: не плодим параллельные прогоны если предыдущий ещё в очереди/работе.
    if (await this.deps.commitSyncJobs.existsActiveForProject(projectId)) return null;

    const allTasks = await this.deps.tasks.listByProject(projectId);
    // Сверка сопоставляет коммиты ТОЛЬКО с задачами в первой колонке «Черновики» (backlog):
    // это черновики-заготовки, которые владелец реализует и коммитит. Задачи в «Воркер»(todo)/
    // «Вручную»(manual) сверка не трогает — там свой ручной/агентный флоу. См. запрос владельца.
    const openTasks = allTasks.filter((t) => t.status === 'backlog');
    // Даже без черновиков прогон ставим (планировщик пометит дату) — сопоставлять просто нечего.

    // Репозиторий читаем токеном того, у кого GitHub реально подключён: диспетчер, если он
    // привязал аккаунт, иначе — владелец проекта (он завёл репозиторий). Центральный
    // agent-runner (типовой диспетчер, напр. admin@) обычно без GitHub — без этого фолбэка
    // сверка падала бы «недоступна» у всех таких проектов. Нет токена ни у кого / нет
    // репозитория → пропускаем прогон (планировщик пометит дату).
    const dispatcherGithub = await this.deps.tokens.getByUserId(dispatcherUserId);
    const repoReaderId = dispatcherGithub ? dispatcherUserId : (project.ownerId ?? dispatcherUserId);
    let commits;
    try {
      commits = await this.deps.listProjectCommits.execute(
        projectId,
        repoReaderId,
        COMMIT_FETCH_LIMIT,
        {
          detailSince: new Date(now.getTime() - commitReviewWindowHours(now) * 3_600_000),
          detailLimit: 12,
        },
      );
    } catch {
      return null;
    }
    const { context, commits: commitSnapshot } = prepareCommitSyncContext({
      tasks: openTasks,
      commits,
      thresholdHours: config.commitSyncThresholdHours,
      now,
    });

    return this.deps.commitSyncJobs.create({
      projectId,
      // Инициатор = владелец проекта (включивший автоматизацию): на его тариф метерим/гейтим,
      // чтобы commit-sync не был бесплатным расходом подписки.
      createdBy: project.ownerId,
      dispatcherUserId,
      action: config.commitSyncAction,
      thresholdHours: config.commitSyncThresholdHours,
      context,
      commitsJson: JSON.stringify(commitSnapshot),
    });
  }
}
