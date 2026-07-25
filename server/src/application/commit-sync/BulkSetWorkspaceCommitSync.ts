import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import { requireWorkspaceMember } from '../workspace/workspaceAccess.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';

type Deps = {
  readonly workspaces: WorkspaceRepository;
  readonly automation: Pick<AutomationRepository, 'bulkSetCommitSyncSchedule'>;
};

export type BulkSetWorkspaceCommitSyncInput = {
  readonly hour: number;
  readonly minute: number;
  readonly daysOfWeek: readonly number[];
  // Режим сверки: 'auto' — переносить задачи автоматически, 'propose' — только оповещать.
  readonly action: 'propose' | 'auto';
};

/**
 * Применить ОБЩЕЕ расписание сверки коммитов (время/дни/режим) ко всем проектам пространства.
 *
 * Расписание в модели общее: одно на пространство, применяется во все окна автоматизаций
 * проектов. Включённость же (какие проекты сверяются) — пер-проектная и задаётся отдельно из
 * чеклиста (SetWorkspaceCommitSyncProjects). Поэтому здесь enabled НЕ трогается — только
 * время/дни/режим, дальше каждый проект гоняется своим CommitSyncScheduler.
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
    const affected = await this.deps.automation.bulkSetCommitSyncSchedule(workspaceId, {
      hour: input.hour,
      minute: input.minute,
      daysOfWeek: days,
      action: input.action,
    });
    return { affected };
  }
}
