// Тип пространства:
//  • 'default' — личный хаб пользователя: один на владельца, неудаляем, агрегирует ВСЕ его
//    проекты (свои + куда приглашён) и держит общий чат со всеми коллабораторами. Чужие
//    дефолт-хабы не показываются в свитчере.
//  • 'team' — созданное вручную командное пространство: свои участники, свой срез проектов,
//    свой чат.
export type WorkspaceKind = 'default' | 'team';

// Режим сверки коммитов в пространстве (db/155):
//  • 'off'     — сверки нет вообще, пер-проектные галочки игнорируются;
//  • 'propose' — по умолчанию предлагать закрыть задачу (историческое поведение);
//  • 'auto'    — по умолчанию закрывать задачу самостоятельно.
// Пер-проектный режим (project_automation.commit_sync_action) перекрывает значение
// пространства, пока пространство не выключено. См. CommitSyncPolicy.
export type WorkspaceCommitSyncMode = 'off' | 'propose' | 'auto';

export const WORKSPACE_COMMIT_SYNC_MODES: readonly WorkspaceCommitSyncMode[] = [
  'off',
  'propose',
  'auto',
];

export function isWorkspaceCommitSyncMode(v: unknown): v is WorkspaceCommitSyncMode {
  return v === 'off' || v === 'propose' || v === 'auto';
}

// Пространство (workspace): верхнеуровневый изолированный контейнер над проектами.
// Проект принадлежит ровно одному пространству; у пространства свои участники.
export type Workspace = {
  readonly id: string;
  readonly name: string;
  // Эмодзи-иконка; null = дефолт (первая буква названия в UI).
  readonly icon: string | null;
  readonly kind: WorkspaceKind;
  // Приёмка задач руководителем (db/150): «выполнено» от исполнителя переводит задачу в
  // pending_approval, закрыть её может только lead/owner. Выключено по умолчанию —
  // включение меняет привычный сценарий всей команде.
  readonly requireTaskApproval: boolean;
  // Воркер (Ralph) в пространстве (db/152). Выключен — на досках нет колонки «Воркер»
  // (статус 'todo'), а сервер не принимает задачи в этот статус и не отдаёт их агенту.
  // Включён по умолчанию: это привычное поведение, выключение — осознанный выбор команды.
  readonly workerEnabled: boolean;
  // Режим сверки коммитов в пространстве (db/155). Дефолт 'propose'.
  readonly commitSyncMode: WorkspaceCommitSyncMode;
  readonly ownerUserId: string;
  readonly createdAt: Date;
};
