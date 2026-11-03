import type { ProjectStatus } from '@/domain/project/Project';
import type { PlanId } from '@/domain/usage/Usage';

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
  // Тариф юзера + дата окончания подписки (ISO|null) — для бейджа/контрола в админке.
  readonly plan: PlanId;
  readonly subscriptionExpiresAt: string | null;
  // Привязка Telegram: есть ли и @username, если известен (для «Отвязать Telegram»).
  readonly telegramLinked: boolean;
  readonly telegramUsername: string | null;
};

export type AdminUserPatch = {
  readonly displayName?: string;
  readonly email?: string;
  readonly isAdmin?: boolean;
  readonly avatarUrl?: null;
  readonly telegram?: null;
};

// Что произойдёт при удалении пользователя — считается сервером по тем же правилам, что и само
// удаление. blockers непустой — удалить нельзя, пока причины не устранены.
export type AdminUserDeletionBlocker =
  | { readonly kind: 'self' }
  | { readonly kind: 'admin' }
  | { readonly kind: 'owned_workspace'; readonly workspaceId: string; readonly name: string; readonly members: number };

export type AdminUserDeletionPreview = {
  readonly blockers: readonly AdminUserDeletionBlocker[];
  readonly removedWorkspaces: readonly { readonly name: string; readonly kind: 'default' | 'team' }[];
  readonly removedProjects: number;
  readonly removedTasks: number;
  readonly reassignedTasks: number;
  readonly leftWorkspaces: readonly { readonly name: string; readonly successorName: string | null }[];
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

// Вкладка «Статистика»: дневные ряды метрик платформы (дни по Москве) и прогноз на 30 дней.
export type StatsPoint = { readonly day: string; readonly value: number };
export type StatsForecastPoint = StatsPoint & { readonly low: number; readonly high: number };
export type PlatformStatsMetric = {
  readonly key: 'activeUsers' | 'registrations' | 'tasksCreated' | 'comments';
  readonly label: string;
  readonly points: StatsPoint[];
  readonly forecast: StatsForecastPoint[];
  readonly last30: number;
  readonly prev30: number;
  readonly forecastNext30: number;
};
export type PlatformStats = {
  readonly from: string;
  readonly to: string;
  readonly totals: {
    readonly users: number;
    readonly workspaces: number;
    readonly projects: number;
    readonly tasks: number;
    readonly paidUsers: number;
    readonly activeWeek: number;
    readonly activeMonth: number;
  };
  readonly metrics: PlatformStatsMetric[];
};

export interface AdminRepository {
  getPlatformStats(): Promise<PlatformStats>;
  listProjects(): Promise<AdminProject[]>;
  listUsers(): Promise<AdminUser[]>;
  updateUser(id: string, patch: AdminUserPatch): Promise<void>;
  getUserDeletionPreview(id: string): Promise<AdminUserDeletionPreview>;
  deleteUser(id: string): Promise<void>;
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
  // Omitted expiry grants 30 days; null means unlimited. free resets the subscription.
  setUserPlan(id: string, plan: PlanId, subscriptionExpiresAt?: string | null): Promise<void>;
}
