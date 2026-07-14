import type { RealtimeEvent } from '../../domain/realtime/RealtimeEvent.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { RealtimePublisher } from './RealtimePublisher.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly publisher: RealtimePublisher;
};

// Транслирует доменное событие проекта всем его участникам (по их userId). Так чужие
// вкладки/сессии узнают об изменении и рефетчат данные. Best-effort: ошибки резолва
// участников не должны влиять на основной запрос (вызывающий код глотает reject).
export class ProjectEventBroadcaster {
  constructor(private readonly deps: Deps) {}

  async broadcast(
    projectId: string,
    kind: 'task_changed' | 'project_changed',
  ): Promise<void> {
    const members = await this.deps.members.listByProject(projectId);
    for (const m of members) {
      this.deps.publisher.publish(m.userId, { kind, projectId } as RealtimeEvent);
    }
  }

  async broadcastTaskVersionCreated(event: {
    readonly projectId: string;
    readonly taskId: string;
    readonly actorUserId: string | null;
    readonly changedFields: readonly string[];
    readonly createdAt: Date;
    readonly recipientUserIds: readonly string[];
  }): Promise<void> {
    const members = await this.deps.members.listByProject(event.projectId);
    const actorDisplayName = event.actorUserId
      ? (members.find((member) => member.userId === event.actorUserId)?.user.displayName ?? null)
      : null;
    const recipientUserIds = new Set([
      ...members.map((member) => member.userId),
      ...event.recipientUserIds,
    ]);
    for (const userId of recipientUserIds) {
      this.deps.publisher.publish(userId, {
        kind: 'task_version_created',
        projectId: event.projectId,
        taskId: event.taskId,
        actorUserId: event.actorUserId,
        actorDisplayName,
        changedFields: event.changedFields,
        createdAt: event.createdAt.toISOString(),
      });
    }
  }

  // Отдельный метод для comment_added — нужны taskId/commentId/ownerUserId, чтобы Ralph
  // диспетчер мгновенно подхватывал ответы юзера без 30с polling'а GET .../comments.
  async broadcastCommentAdded(
    projectId: string,
    taskId: string,
    commentId: string,
    ownerUserId: string,
    actorKind?: 'user' | 'agent' | 'system',
    agentName?: string | null,
  ): Promise<void> {
    const members = await this.deps.members.listByProject(projectId);
    for (const m of members) {
      this.deps.publisher.publish(m.userId, {
        kind: 'comment_added',
        projectId,
        taskId,
        commentId,
        ownerUserId,
        actorKind,
        agentName,
      });
    }
  }

  // Смена статуса задачи (через move или авто-возврат awaiting_clarification → in_progress).
  // old/new нужны клиенту чтобы анимировать переезд между колонками канбана и подсветить
  // @mention'ы попавшие на awaiting_clarification.
  async broadcastStatusChanged(
    projectId: string,
    taskId: string,
    oldStatus: string,
    newStatus: string,
    actorUserId: string,
  ): Promise<void> {
    const members = await this.deps.members.listByProject(projectId);
    for (const m of members) {
      this.deps.publisher.publish(m.userId, {
        kind: 'task_status_changed',
        projectId,
        taskId,
        oldStatus,
        newStatus,
        actorUserId,
      });
    }
  }

  // Сохранён снимок мониторинга — участники проекта мгновенно перекрашивают статус сервера.
  async broadcastSnapshotStored(projectId: string, serverId: string, status: string): Promise<void> {
    const members = await this.deps.members.listByProject(projectId);
    for (const m of members) {
      this.deps.publisher.publish(m.userId, { kind: 'snapshot_stored', projectId, serverId, status });
    }
  }

  // LIVE-сессия стартовала/завершилась — бейдж 🔴 на карточке задачи всем участникам.
  // Лёгкое событие (без firehose ленты — та идёт в task-scoped LiveEventHub).
  async broadcastLiveSessionChanged(
    projectId: string,
    taskId: string,
    sessionId: string,
    status: 'running' | 'completed' | 'failed' | 'timeout' | 'canceled',
  ): Promise<void> {
    const members = await this.deps.members.listByProject(projectId);
    for (const m of members) {
      this.deps.publisher.publish(m.userId, {
        kind: 'live_session_changed',
        projectId,
        taskId,
        sessionId,
        status,
      });
    }
  }
}
