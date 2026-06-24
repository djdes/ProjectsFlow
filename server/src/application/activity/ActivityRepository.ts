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
  /** GC: удалить события старше cutoff. Возвращает число удалённых. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}
