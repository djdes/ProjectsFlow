import type {
  MemberTaskScope,
  ProjectSharing,
  SaveProjectSharingInput,
  WorkspaceTaskScope,
} from '@/domain/project/ProjectSharing';

// Черновик окна «Доступ пространств»: какие пространства подключены, их правила и правила людей.
export type WorkspaceAccessDraft = {
  readonly workspaces: ReadonlyMap<string, { readonly connected: boolean; readonly scope: WorkspaceTaskScope }>;
  readonly members: ReadonlyMap<string, MemberTaskScope | null>;
};

export const WORKSPACE_SCOPE_LABEL: Record<WorkspaceTaskScope['kind'], string> = {
  all: 'Все задачи',
  own: 'Только свои',
  selected: 'Свои и выбранных пространств',
};

export const MEMBER_SCOPE_LABEL: Record<MemberTaskScope['kind'] | 'workspace', string> = {
  workspace: 'По правилу пространства',
  all: 'Все задачи',
  mine: 'Только свои',
  selected: 'Из выбранных пространств',
};

export function draftFromView(view: ProjectSharing): WorkspaceAccessDraft {
  return {
    workspaces: new Map(view.workspaces.map((w) => [w.id, { connected: w.connected, scope: w.taskScope }])),
    members: new Map(view.members.map((m) => [m.userId, m.rule])),
  };
}

// Подключённые пространства черновика (основное всегда первым).
export function connectedIds(view: ProjectSharing, draft: WorkspaceAccessDraft): string[] {
  return view.workspaces.filter((w) => w.isHome || draft.workspaces.get(w.id)?.connected).map((w) => w.id);
}

// Ссылки «из выбранных» — только на подключённые пространства; правило людей — только тем,
// у кого есть доступ (хотя бы одно их пространство подключено).
export function toSaveInput(view: ProjectSharing, draft: WorkspaceAccessDraft): SaveProjectSharingInput {
  const connected = connectedIds(view, draft);
  const clean = <T extends WorkspaceTaskScope | MemberTaskScope>(scope: T): T =>
    scope.kind === 'selected' ? ({ ...scope, from: scope.from.filter((id) => connected.includes(id)) } as T) : scope;
  return {
    workspaces: connected.map((workspaceId) => ({
      workspaceId,
      taskScope: clean(draft.workspaces.get(workspaceId)?.scope ?? { kind: 'own' }),
    })),
    members: view.members.flatMap((member) => {
      const rule = draft.members.get(member.userId) ?? null;
      if (!rule) return [];
      if (!member.workspaceIds.some((id) => connected.includes(id))) return [];
      return [{ userId: member.userId, taskScope: clean(rule) }];
    }),
  };
}
