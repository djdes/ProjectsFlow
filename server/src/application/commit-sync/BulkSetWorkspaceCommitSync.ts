import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import { requireWorkspaceMember } from '../workspace/workspaceAccess.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';

type Deps = {
  readonly workspaces: WorkspaceRepository;
  readonly automation: Pick<AutomationRepository, 'bulkSetCommitSync'>;
};

export type BulkSetWorkspaceCommitSyncInput = {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly daysOfWeek: readonly number[];
};

/**
 * Мастер-действие пространства «включить сверку коммитов по всем проектам».
 *
 * Пишет тумблер + время + дни во ВСЕ проекты пространства разом, а не хранит отдельную
 * воркспейс-настройку: пользователь просил, чтобы «включилось во всех окнах автоматизаций
 * проектов». То есть это не второй источник правды, а bulk-запись per-project конфига —
 * дальше каждый проект гоняется своим CommitSyncScheduler по этим значениям, и его окно
 * автоматизации показывает ровно то, что применили.
 *
 * Гейт — участник пространства (как у настроек дайджеста). Возвращает число затронутых проектов.
 */
export class BulkSetWorkspaceCommitSync {
  constructor(private readonly deps: Deps) {}

  async execute(
    workspaceId: string,
    actorUserId: string,
    input: BulkSetWorkspaceCommitSyncInput,
  ): Promise<{ affected: number }> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    // Пустой список дней бессмыслен (сверка не запустится никогда) — трактуем как «каждый день».
    const days = input.daysOfWeek.length > 0 ? input.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
    const affected = await this.deps.automation.bulkSetCommitSync(workspaceId, {
      enabled: input.enabled,
      hour: input.hour,
      minute: input.minute,
      daysOfWeek: days,
    });
    return { affected };
  }
}
