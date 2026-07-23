import type { ProjectAccessDeps } from '../project/projectAccess.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { EnqueueCommitSyncJob } from './EnqueueCommitSyncJob.js';
import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';

// Почему не вышло поставить ручную сверку. Клиент показывает пользователю понятный текст.
export type RunCommitSyncNowResult =
  | { readonly ok: true; readonly jobId: string }
  | { readonly ok: false; readonly reason: 'already_running' | 'unavailable' };

type Deps = ProjectAccessDeps & {
  readonly enqueue: Pick<EnqueueCommitSyncJob, 'execute'>;
  readonly commitSyncJobs: Pick<CommitSyncJobRepository, 'existsActiveForProject'>;
};

/**
 * Ручной запуск сверки коммитов «Сверить сейчас» — то, что нажимает пользователь, поработав.
 *
 * Отличается от планового прогона только источником: здесь forceEnabled=true, потому что
 * человек нажал кнопку осознанно — тумблер «Сверка коммитов» в этот момент не при чём (он
 * управляет ТОЛЬКО ежедневным авто-прогоном). Всё остальное — тот же EnqueueCommitSyncJob:
 * тянет коммиты токеном диспетчера, кладёт job, дальше его подхватывает раннер.
 *
 * Гейт — update_project (editor+), как у сохранения конфига автоматизации.
 *
 * «Уже идёт» отделяем явно: повторный клик по кнопке не должен молча ничего не делать —
 * пользователь должен видеть, что прогон уже в очереди.
 */
export class RunCommitSyncNow {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<RunCommitSyncNowResult> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');

    if (await this.deps.commitSyncJobs.existsActiveForProject(projectId)) {
      return { ok: false, reason: 'already_running' };
    }

    const job = await this.deps.enqueue.execute(projectId, new Date(), { forceEnabled: true });
    // null здесь — не «выключено» (мы форсим), а нет диспетчера / нет GitHub-доступа /
    // между проверкой и enqueue кто-то уже поставил прогон. Для пользователя это «недоступно».
    if (!job) return { ok: false, reason: 'unavailable' };
    return { ok: true, jobId: job.id };
  }
}
