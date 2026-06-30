import type { ProjectStatus } from '@/domain/project/Project';

export type AdminProject = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly ownerId: string;
  readonly ownerDisplayName: string;
  readonly ownerEmail: string;
  readonly memberCount: number;
  readonly taskCount: number;
};

export type AdminUser = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly isAdmin: boolean;
  readonly projectCount: number;
  // Сколько owned-проектов (для знаменателя badge'а делегации).
  readonly ownedProjectCount: number;
  // Сколько owned-проектов имеют включённую GitHub-делегацию (числитель).
  readonly delegationEnabledCount: number;
  // Подключён ли GitHub. Если нет — делегацию включать нельзя.
  readonly githubConnected: boolean;
};

export type AdminUserPatch = {
  readonly displayName?: string;
  readonly email?: string;
  readonly isAdmin?: boolean;
};

// Проект юзера + его текущий диспетчер (с резолвом имён) + флаг GitHub-делегации.
// Используется admin-страницей в колонке «Проекты / Диспетчеры».
export type AdminUserProjectDispatcher = {
  readonly projectId: string;
  readonly projectName: string;
  readonly status: ProjectStatus;
  readonly isInbox: boolean;
  readonly dispatcherUserId: string | null;
  readonly dispatcherDisplayName: string | null;
  readonly dispatcherEmail: string | null;
  // Включена ли делегация GitHub-токена owner'а текущему диспетчеру.
  // Admin может toggle'нуть «за owner'а» через projectRepository.setGitTokenDelegation.
  readonly gitTokenDelegationEnabled: boolean;
};

// Проект юзера + его персональный favorite-флаг. Используется admin-диалогом «Избранное»
// — admin видит и переключает избранное за этого юзера. Inbox в список не попадает.
export type AdminUserProjectFavorite = {
  readonly projectId: string;
  readonly projectName: string;
  readonly status: ProjectStatus;
  readonly isInbox: boolean;
  readonly isFavorite: boolean;
  readonly favoriteSortOrder: number;
};

export type EmailTemplateMeta = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
};

export type EmailPreview = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

// Обращение в поддержку для админ-раздела. submitter* = null для анонимных (с лендинга).
export type AdminSupportTicket = {
  readonly id: string;
  readonly userId: string | null;
  readonly message: string;
  readonly source: 'app' | 'landing';
  readonly status: 'open' | 'closed';
  readonly createdAt: string; // ISO
  readonly submitterDisplayName: string | null;
  readonly submitterEmail: string | null;
};

export interface AdminRepository {
  listProjects(): Promise<AdminProject[]>;
  listUsers(): Promise<AdminUser[]>;
  updateUser(id: string, patch: AdminUserPatch): Promise<void>;
  // Проекты юзера (где он owner) + текущие диспетчеры. Сменить диспетчера
  // admin может через обычный `projectRepository.setDispatcher` (admin-bypass).
  listUserProjectsWithDispatcher(userId: string): Promise<AdminUserProjectDispatcher[]>;
  // Проекты юзера + его персональный favorite-флаг (без inbox). Admin переключает
  // избранное за юзера через setUserProjectFavorite.
  listUserProjectsWithFavorites(userId: string): Promise<AdminUserProjectFavorite[]>;
  setUserProjectFavorite(userId: string, projectId: string, favorite: boolean): Promise<void>;
  listEmailTemplates(): Promise<EmailTemplateMeta[]>;
  previewEmail(templateKey: string): Promise<EmailPreview>;
  sendTestEmail(templateKey: string, recipientEmail: string): Promise<void>;
  // Обращения в поддержку (раздел «Администрирование» → вкладка «Поддержка»).
  listSupportTickets(): Promise<AdminSupportTicket[]>;
  setSupportTicketStatus(id: string, status: 'open' | 'closed'): Promise<void>;
}
