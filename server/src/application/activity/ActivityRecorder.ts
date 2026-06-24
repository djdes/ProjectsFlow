import type { ActivityKind, ActivityPayload } from '../../domain/activity/ActivityEvent.js';
import type { ActivityRepository } from './ActivityRepository.js';

type Deps = {
  readonly activity: ActivityRepository;
  // Резолвит пространство проекта (projectRepo.getWorkspaceId). NULL = проект исчез → пропускаем.
  readonly resolveWorkspaceId: (projectId: string) => Promise<string | null>;
  readonly idGen: () => string;
};

export type RecordInput = {
  readonly projectId: string;
  readonly actorUserId: string | null;
  readonly kind: ActivityKind;
  readonly payload?: ActivityPayload | null;
  // Если известно (напр., при удалении проекта) — можно передать явно, избежав лишнего lookup.
  readonly workspaceId?: string;
};

// Запись амбиентного события в ленту. ВСЕГДА best-effort: никогда не роняет основную
// операцию (создание задачи и т.п.) — как ProjectNotificationService.
export class ActivityRecorder {
  constructor(private readonly deps: Deps) {}

  async record(input: RecordInput): Promise<void> {
    try {
      const workspaceId = input.workspaceId ?? (await this.deps.resolveWorkspaceId(input.projectId));
      if (!workspaceId) return;
      await this.deps.activity.record({
        id: this.deps.idGen(),
        workspaceId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        kind: input.kind,
        payload: input.payload ?? null,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[ActivityRecorder] failed to record', input.kind, e);
    }
  }
}
