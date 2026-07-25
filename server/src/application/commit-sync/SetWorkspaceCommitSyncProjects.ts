import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import { requireWorkspaceMember } from '../workspace/workspaceAccess.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';

type Deps = {
  readonly workspaces: WorkspaceRepository;
  readonly automation: Pick<AutomationRepository, 'setCommitSyncEnabledProjects'>;
};

/**
 * Пер-проектная включённость сверки коммитов из чеклиста настроек пространства.
 * Проекты из enabledProjectIds включаются, остальные проекты пространства — выключаются.
 * Расписание (время/дни/режим) — общее и задаётся отдельно (BulkSetWorkspaceCommitSync).
 * Гейт — участник пространства. Возвращает число затронутых проектов.
 */
export class SetWorkspaceCommitSyncProjects {
  constructor(private readonly deps: Deps) {}

  async execute(
    workspaceId: string,
    actorUserId: string,
    enabledProjectIds: readonly string[],
  ): Promise<{ affected: number }> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    // Дедуп на всякий случай — клиент может прислать повторы.
    const unique = [...new Set(enabledProjectIds)];
    const affected = await this.deps.automation.setCommitSyncEnabledProjects(
      workspaceId,
      unique,
    );
    return { affected };
  }
}
