// Роли пространства (после унификации доступа): owner управляет командой, editor
// редактирует все проекты, viewer только смотрит. Legacy 'member' мигрирован в 'editor'.
export type WorkspaceRole = 'owner' | 'lead' | 'editor' | 'viewer';

// Подписи ролей в UI. 'lead' — руководитель: права владельца + сводки и события по всей
// команде в личный чат бота и на почту.
export const WORKSPACE_ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Владелец',
  lead: 'Руководитель',
  editor: 'Редактор',
  viewer: 'Наблюдатель',
};

// 'default' — личный хаб (все мои проекты + общий чат, неудаляем, один на юзера);
// 'team' — созданное вручную командное пространство.
export type WorkspaceKind = 'default' | 'team';

// Режим сверки коммитов в пространстве (db/155). Зеркало серверного домена.
export type WorkspaceCommitSyncMode = 'off' | 'propose' | 'auto';

export const WORKSPACE_COMMIT_SYNC_MODE_LABEL: Record<WorkspaceCommitSyncMode, string> = {
  off: 'Выключена',
  propose: 'Предлагать закрыть',
  auto: 'Закрывать автоматически',
};

// Пространство (workspace): верхнеуровневый изолированный контейнер над проектами.
export type Workspace = {
  readonly id: string;
  readonly name: string;
  // Эмодзи-иконка; null = дефолт (первая буква названия).
  readonly icon: string | null;
  readonly kind: WorkspaceKind;
  // Приёмка задач руководителем (db/150): «выполнено» от участника отправляет задачу
  // на утверждение, закрыть её может только руководитель или владелец пространства.
  readonly requireTaskApproval: boolean;
  // Воркер (Ralph) в пространстве (db/152). Выключен — на досках нет колонки «Воркер»
  // (статус 'todo'), быстрое добавление не предлагает «Воркеру», сервер не пускает в этот
  // статус. Команда работает как в обычном канбане.
  readonly workerEnabled: boolean;
  // Режим сверки коммитов в пространстве (db/155). 'off' — сверки нет вообще; 'propose' —
  // предлагать закрыть задачу; 'auto' — закрывать самостоятельно. Пер-проектный режим
  // перекрывает значение пространства, пока оно не 'off'.
  readonly commitSyncMode: WorkspaceCommitSyncMode;
  readonly ownerUserId: string;
  // Роль текущего юзера в пространстве.
  readonly role: WorkspaceRole;
  // Число проектов в пространстве (read-model для UI). Для дефолт-хаба — все проекты юзера.
  readonly projectCount: number;
  // Число участников пространства (read-model для UI).
  readonly memberCount: number;
  // Активное ли это пространство у текущего юзера (источник правды — сервер).
  readonly isCurrent: boolean;
  readonly createdAt: Date;
};

// Участник пространства (для страницы настроек).
export type WorkspaceMember = {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly role: WorkspaceRole;
};
