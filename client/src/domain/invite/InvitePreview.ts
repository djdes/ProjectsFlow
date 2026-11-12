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
  readonly authMode?: 'login' | 'register';
  readonly expiresAt: Date;
};

// Результат accept: ws-инвайт → workspaceId; legacy project-инвайт → projectId (+ его
// пространство). Клиент ведёт на проект, если он есть, иначе на главную.
export type InviteAcceptResult = {
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  // Приглашение бота из рабочей Telegram-группы (db/181). Telegram при принятии НЕ
  // привязывается: pair — ссылка, по которой владелец аккаунта сам подключает Telegram (после
  // этого бот создаст задачу из группы); linked — у аккаунта уже этот Telegram, задача
  // создаётся; conflict — у аккаунта другой Telegram.
  readonly telegram?: InviteTelegramStep;
};

export type InviteTelegramStep =
  | { readonly status: 'pair'; readonly url: string }
  | { readonly status: 'linked' }
  | { readonly status: 'conflict' }
  | null;
