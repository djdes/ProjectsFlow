import type { ActivityEvent, ActivityKind, ActivityPayload } from '../../domain/activity/ActivityEvent.js';

export type RecordActivityInput = {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorUserId: string | null;
  readonly kind: ActivityKind;
  readonly payload: ActivityPayload | null;
};

export interface ActivityRepository {
  record(input: RecordActivityInput): Promise<void>;
  /**
   * События проектов пространства, где userId — участник (JOIN project_members),
   * created_at < before (если задан), DESC, не больше limit.
   */
  listForUserInWorkspace(
    userId: string,
    workspaceId: string,
    opts: { before?: Date; limit: number },
  ): Promise<ActivityEvent[]>;
  /** События КОНКРЕТНОГО проекта (для окна активности проекта). Доступ гейтит use-case. */
  listForProject(
    projectId: string,
    opts: { before?: Date; beforeId?: string; limit: number },
  ): Promise<ActivityEvent[]>;
  /**
   * Закрытые пользователем задачи и завершённая работа воркера по задачам,
   * где пользователь — ответственный, начиная с `since`.
   *
   * Считаем переходы в 'done' И в 'pending_approval': при включённой приёмке «выполнено»
   * исполнителя уводит задачу на утверждение, и без второго статуса его счётчик всегда
   * показывал бы ноль. Считаются только текущие done/pending_approval без удалённых,
   * разные задачи: возврат в работу убирает зачёт, повторы не накручивают счётчик.
   */
  countTasksCompletedByActorSince(actorUserId: string, since: Date, workspaceId: string): Promise<number>;
  /**
   * То же, но с разбивкой по пространствам: «сколько я закрыл за окно и где». Журнал
   * чистится через 30 дней (см. sweepActivity в index.ts) — окно шире отдаст те же цифры,
   * и обещать по нему «за всё время» нельзя.
   */
  countCompletedByActorPerWorkspaceSince(
    actorUserId: string,
    since: Date,
  ): Promise<Array<{ workspaceId: string; count: number }>>;
  /** GC: удалить события старше cutoff. Возвращает число удалённых. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}
