import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';
import type { Project } from '../../domain/project/Project.js';
import type { User } from '../../domain/user/User.js';
import type { NotificationPrefs } from '../../domain/notifications/NotificationPrefs.js';

export type ProjectMemberWithUser = ProjectMembership & {
  readonly user: User;
  // Пер-участниковые настройки email-оповещений (NULL = дефолты). Нужны рассылке.
  readonly notificationPrefs: NotificationPrefs | null;
};

export type ProjectWithRole = Project & {
  readonly role: ProjectRole;
  // Read-model для sidebar: число участников (>1 ⇒ совместный проект) и общее число задач.
  readonly memberCount: number;
  readonly taskCount: number;
  // Персональный favorite-флаг (см. db/040). UI рисует секцию «Избранное» сверху сайдбара.
  readonly isFavorite: boolean;
  // Порядок внутри секции «Избранное» (имеет смысл только при isFavorite=true).
  readonly favoriteSortOrder: number;
};

export type AddMemberInput = {
  readonly projectId: string;
  readonly userId: string;
  readonly role: ProjectRole;
};

export interface ProjectMemberRepository {
  // Главный метод доступа: «может ли userId смотреть/менять projectId, и с какой ролью».
  // Возвращает null если юзер не member — use-case обычно мапит в ProjectNotFoundError (404).
  findForProject(projectId: string, userId: string): Promise<ProjectMembership | null>;

  // Список members проекта c user-данными (имя, аватар, email). Нужен для UI «Команда».
  listByProject(projectId: string): Promise<ProjectMemberWithUser[]>;

  // Проекты в которых юзер состоит, с его ролью. БЕЗ скоупинга по пространству —
  // используется telegram/admin/notifications где нужны все проекты юзера.
  listProjectsForUser(userId: string): Promise<ProjectWithRole[]>;

  // Как listProjectsForUser, но только проекты заданного пространства. Используется
  // в ListProjects (сайдбар / GET /api/projects) для изоляции по активному пространству.
  listProjectsForUserInWorkspace(userId: string, workspaceId: string): Promise<ProjectWithRole[]>;

  // Сколько owner'ов у проекта — для валидации «не понизь последнего owner'а».
  countOwners(projectId: string): Promise<number>;

  // Есть ли у userId общий (не-inbox) проект с ownerUserId. Считается через общие пространства.
  isMemberOfAnyProjectOwnedBy(userId: string, ownerUserId: string): Promise<boolean>;

  add(input: AddMemberInput): Promise<ProjectMembership>;
  remove(projectId: string, userId: string): Promise<boolean>;
  updateRole(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMembership | null>;

  // Персональная пересортировка проектов в сайдбаре userId. orderedIds задаёт желаемый
  // порядок; sort_order проставляется по индексу. id, по которым у юзера нет membership,
  // игнорируются (UPDATE по (projectId,userId) просто не затронет строк).
  reorderForUser(userId: string, orderedIds: readonly string[]): Promise<void>;

  // Toggle favorite-флага для (projectId,userId). При favorite=true репо ставит
  // favorite_sort_order = MAX(favorite_sort_order среди favorites юзера) + 1 — новый
  // избранный встаёт в конец секции, не схлопываясь в 0. При favorite=false — просто
  // сбрасывает флаг (favorite_sort_order остаётся как мусор, но не влияет на UI).
  setFavorite(projectId: string, userId: string, favorite: boolean): Promise<void>;

  // Пересортировка favorites юзера. Симметрично reorderForUser, но пишет
  // favorite_sort_order и только для строк, где is_favorite=true (остальные не затрагиваются).
  reorderFavoritesForUser(userId: string, orderedIds: readonly string[]): Promise<void>;

  // Пер-участниковые настройки email-оповещений (NULL = дефолты).
  getNotificationPrefs(projectId: string, userId: string): Promise<NotificationPrefs | null>;
  setNotificationPrefs(
    projectId: string,
    userId: string,
    prefs: NotificationPrefs,
  ): Promise<void>;

  // Дедуплицированный список user'ов, с которыми caller состоит в общих проектах.
  // Без caller'а самого. Используется для дропдауна «делегировать» во входящих.
  listSharedUsers(userId: string): Promise<SharedUser[]>;
}

export type SharedUser = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
};
