import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import { requireWorkspaceMember } from '../workspace/workspaceAccess.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';

type Deps = {
  readonly workspaces: WorkspaceRepository;
  readonly automation: Pick<AutomationRepository, 'listWorkspaceProjectsCommitSync'>;
};

export type WorkspaceCommitSyncProject = {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly commitSyncEnabled: boolean;
};

/**
 * Проекты пространства с их пер-проектным флагом «включён в сверку коммитов».
 * Питает чеклист в настройках пространства — быстрый выбор без захода в каждый проект.
 * Гейт — участник пространства (как у настроек дайджеста).
 */
export class ListWorkspaceCommitSyncProjects {
  constructor(private readonly deps: Deps) {}

  async execute(
    workspaceId: string,
    actorUserId: string,
  ): Promise<ReadonlyArray<WorkspaceCommitSyncProject>> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    return this.deps.automation.listWorkspaceProjectsCommitSync(workspaceId);
  }
}
