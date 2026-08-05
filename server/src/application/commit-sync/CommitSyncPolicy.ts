import type { WorkspaceCommitSyncMode } from '../../domain/workspace/Workspace.js';

// Узкие структурные порты: политике нужно ровно две вещи — в каком пространстве живёт
// проект и какой там режим сверки. Зеркало WorkerPolicy (application/workspace).
type ProjectsPort = {
  getWorkspaceId(projectId: string): Promise<string | null>;
};
type WorkspacesPort = {
  getById(id: string): Promise<{ commitSyncMode: WorkspaceCommitSyncMode } | null>;
};

type Deps = {
  readonly projects: ProjectsPort;
  readonly workspaces: WorkspacesPort;
};

export type CommitSyncDecision =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly action: 'propose' | 'auto' };

/**
 * Одна точка правды «сверяем ли коммиты этого проекта и что делаем с совпадениями» (db/155).
 *
 * Порядок разрешения — «проект → пространство → режим», как у воркера:
 *   1. Пространство выключило сверку ('off') — сверки нет, пер-проектные галочки не важны.
 *      Это единственный способ снять сверку со всей команды одним действием.
 *   2. Иначе действует пер-проектный режим (project_automation.commit_sync_action): проект
 *      мог осознанно выбрать 'auto', когда пространство по умолчанию только предлагает.
 *   3. Проект режим не выбирал (строки автоматизации нет) — берётся режим пространства.
 *
 * Пространство не найдено (или проект без пространства) — ведём себя как раньше: решает
 * проект. Это состояние «данных нет», и запрещать сверку по нему значит ломать её на пустом месте.
 */
export class CommitSyncPolicy {
  constructor(private readonly deps: Deps) {}

  async resolve(
    projectId: string,
    projectAction: 'propose' | 'auto' | null,
  ): Promise<CommitSyncDecision> {
    const mode = await this.workspaceMode(projectId);
    if (mode === 'off') return { enabled: false };
    // Нет режима пространства (данных нет) — как раньше, решает проект; дефолт 'propose'.
    const fallback: 'propose' | 'auto' = mode ?? 'propose';
    return { enabled: true, action: projectAction ?? fallback };
  }

  private async workspaceMode(projectId: string): Promise<WorkspaceCommitSyncMode | null> {
    const workspaceId = await this.deps.projects.getWorkspaceId(projectId);
    if (!workspaceId) return null;
    const workspace = await this.deps.workspaces.getById(workspaceId);
    return workspace?.commitSyncMode ?? null;
  }
}
