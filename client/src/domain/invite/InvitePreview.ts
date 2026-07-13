// Превью инвайта по токену для /invite/:token (anon-страница). Dual-token: токен может
// быть workspace-инвайтом (новые) или legacy project-инвайтом (уже разосланные ссылки).
export type InviteRole = 'editor' | 'viewer';
export type InviteTargetKind = 'workspace' | 'project';

export type InvitePreview = {
  readonly kind: InviteTargetKind;
  // Название пространства (kind='workspace') или legacy-проекта (kind='project').
  readonly targetName: string;
  readonly role: InviteRole;
  readonly inviterDisplayName: string | null;
  readonly inviteEmail: string | null;
  readonly expiresAt: Date;
};

// Результат accept: ws-инвайт → workspaceId; legacy project-инвайт → projectId (+ его
// пространство). Клиент ведёт на проект, если он есть, иначе на главную.
export type InviteAcceptResult = {
  readonly workspaceId: string | null;
  readonly projectId: string | null;
};
