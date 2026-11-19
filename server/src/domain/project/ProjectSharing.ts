// Один проект в нескольких пространствах (db/182): чистые правила видимости задач.
// См. docs/superpowers/specs/2026-11-12-shared-projects-across-workspaces-design.md.

// Правило пространства: all — все задачи проекта; own — созданные в этом пространстве;
// selected — свои и из пространств `from`.
export type WorkspaceTaskScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'own' }
  | { readonly kind: 'selected'; readonly from: readonly string[] };

// Правило человека заменяет правила пространств: all — все; mine — только где он автор или
// ответственный; selected — задачи пространств `from`.
export type MemberTaskScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'mine' }
  | { readonly kind: 'selected'; readonly from: readonly string[] };

export type ProjectSharing = {
  readonly projectId: string;
  readonly homeWorkspaceId: string;
  // Все пространства проекта (основное + подключённые) и их правила.
  readonly workspaces: ReadonlyMap<string, WorkspaceTaskScope>;
  readonly members: ReadonlyMap<string, MemberTaskScope>;
};

export type TaskVisibilityViewer = {
  readonly userId: string;
  // Пространство, в котором человек смотрит (доска, списки). null — прямая ссылка: тогда
  // объединение правил всех его пространств проекта.
  readonly viewerWorkspaceId: string | null;
  // Пространства проекта, где человек участник (не скрыт галочкой).
  readonly memberWorkspaceIds: readonly string[];
  // Автор проекта или owner/lead основного пространства — настраивают правила, видят всё.
  readonly isAdmin: boolean;
};

export type VisibilityTask = {
  readonly createdBy: string | null;
  readonly assigneeUserId: string;
  readonly originWorkspaceId?: string | null;
};

export const DEFAULT_HOME_SCOPE: WorkspaceTaskScope = { kind: 'all' };
export const DEFAULT_LINKED_SCOPE: WorkspaceTaskScope = { kind: 'own' };

// Общий ли проект: кроме основного подключено хоть одно пространство.
export function isSharedProject(sharing: Pick<ProjectSharing, 'workspaces' | 'homeWorkspaceId'>): boolean {
  for (const id of sharing.workspaces.keys()) if (id !== sharing.homeWorkspaceId) return true;
  return false;
}

// Пространство создания. NULL и пространство, которое больше не подключено к проекту,
// считаются основным: задачи отключённого пространства остаются задачами основного.
export function taskOrigin(
  sharing: Pick<ProjectSharing, 'workspaces' | 'homeWorkspaceId'>,
  task: Pick<VisibilityTask, 'originWorkspaceId'>,
): string {
  const origin = task.originWorkspaceId ?? null;
  return origin !== null && sharing.workspaces.has(origin) ? origin : sharing.homeWorkspaceId;
}

export function canSeeTask(sharing: ProjectSharing, viewer: TaskVisibilityViewer, task: VisibilityTask): boolean {
  if (!isSharedProject(sharing)) return true;
  if (task.createdBy === viewer.userId || task.assigneeUserId === viewer.userId) return true;
  if (viewer.isAdmin) return true;
  const origin = taskOrigin(sharing, task);
  const personal = sharing.members.get(viewer.userId);
  if (personal) {
    if (personal.kind === 'all') return true;
    if (personal.kind === 'mine') return false;
    return personal.from.includes(origin);
  }
  const workspaces =
    viewer.viewerWorkspaceId !== null
      ? viewer.memberWorkspaceIds.filter((id) => id === viewer.viewerWorkspaceId)
      : viewer.memberWorkspaceIds;
  return workspaces.some((workspaceId) => {
    const scope = sharing.workspaces.get(workspaceId);
    if (!scope) return false;
    if (scope.kind === 'all') return true;
    if (origin === workspaceId) return true;
    return scope.kind === 'selected' && scope.from.includes(origin);
  });
}
