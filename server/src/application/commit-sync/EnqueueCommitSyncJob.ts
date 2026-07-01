import type { CommitSyncJob } from '../../domain/commit-sync/CommitSyncJob.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';
import { defaultAutomationConfig } from '../automation/criteria.js';
import type { ListProjectCommits } from '../github/ListProjectCommits.js';
import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';
import { prepareCommitSyncContext } from './prepareCommitSyncContext.js';

// Сколько коммитов отдаём модели на сопоставление (свежие сверху). Хватает покрыть
// несколько дней активности; ranних коммитов для старых задач достаточно для done-перехода.
const COMMIT_FETCH_LIMIT = 100;

type Deps = {
  readonly projects: ProjectRepository;
  readonly automation: AutomationRepository;
  readonly tasks: TaskRepository;
  readonly listProjectCommits: ListProjectCommits;
  readonly commitSyncJobs: CommitSyncJobRepository;
};

// Системный путь (вызывает планировщик): ставит commit-sync job для проекта.
// Возвращает null если делать нечего: нет диспетчера / выключено / нет todo/in_progress
// задач / нет коммитов / уже есть активный job / нет GitHub-доступа. Планировщик в любом
// случае пометит прогон (markCommitSyncRun) — чтобы не ретраить каждую минуту.
export class EnqueueCommitSyncJob {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, now: Date = new Date()): Promise<CommitSyncJob | null> {
    const project = await this.deps.projects.getById(projectId);
    if (!project?.dispatcherUserId) return null;
    const dispatcherUserId = project.dispatcherUserId;

    const config = (await this.deps.automation.getConfig(projectId)) ?? defaultAutomationConfig(projectId);
    if (!config.commitSyncEnabled) return null;

    // Дедуп: не плодим параллельные прогоны если предыдущий ещё в очереди/работе.
    if (await this.deps.commitSyncJobs.existsActiveForProject(projectId)) return null;

    const allTasks = await this.deps.tasks.listByProject(projectId);
    const openTasks = allTasks.filter((t) => t.status === 'todo' || t.status === 'in_progress');
    if (openTasks.length === 0) return null;

    // Коммиты тянем токеном диспетчера (он — участник проекта, read_project проходит).
    // Нет GitHub-токена / репозитория → пропускаем прогон (планировщик пометит дату).
    let commits;
    try {
      commits = await this.deps.listProjectCommits.execute(
        projectId,
        dispatcherUserId,
        COMMIT_FETCH_LIMIT,
      );
    } catch {
      return null;
    }
    if (commits.length === 0) return null;

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
      thresholdHours: config.commitSyncThresholdHours,
      context,
      commitsJson: JSON.stringify(commitSnapshot),
    });
  }
}
