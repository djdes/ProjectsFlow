// Один проект в нескольких пространствах (db/182): «Доступ пространств».

// Правило пространства: all — все задачи проекта; own — созданные в этом пространстве;
// selected — свои и из выбранных пространств.
export type WorkspaceTaskScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'own' }
  | { readonly kind: 'selected'; readonly from: readonly string[] };

// Правило человека заменяет правила пространств: all — все; mine — где он автор или
// ответственный; selected — задачи выбранных пространств.
export type MemberTaskScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'mine' }
  | { readonly kind: 'selected'; readonly from: readonly string[] };

export type ProjectSharingWorkspace = {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly isHome: boolean;
  readonly connected: boolean;
  readonly taskScope: WorkspaceTaskScope;
};

export type ProjectSharingMember = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly workspaceIds: readonly string[];
  readonly rule: MemberTaskScope | null;
};

export type ProjectSharing = {
  readonly canManage: boolean;
  readonly homeWorkspaceId: string;
  readonly workspaces: readonly ProjectSharingWorkspace[];
  readonly members: readonly ProjectSharingMember[];
};

export type SaveProjectSharingInput = {
  readonly workspaces: ReadonlyArray<{ readonly workspaceId: string; readonly taskScope: WorkspaceTaskScope }>;
  readonly members: ReadonlyArray<{ readonly userId: string; readonly taskScope: MemberTaskScope }>;
};

// Пространство общего проекта для значка и подписей задач.
export type SharedWorkspaceRef = { readonly id: string; readonly name: string; readonly icon: string | null };
