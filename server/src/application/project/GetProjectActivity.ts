import { requireProjectAccess, type ProjectAccessDeps } from './projectAccess.js';
import type { ActivityRepository } from '../activity/ActivityRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TaskVersionRepository } from '../task/TaskVersionRepository.js';
import type { ActivityKind, ActivityPayload } from '../../domain/activity/ActivityEvent.js';

export type ProjectActivityItem = {
  readonly id: string;
  readonly kind: ActivityKind;
  readonly projectId: string;
  readonly actorUserId: string | null;
  readonly actorDisplayName: string | null;
  readonly actorAvatarUrl: string | null;
  readonly targetDisplayName: string | null;
  readonly payload: ActivityPayload | null;
  readonly createdAt: Date;
  // true, если у задачи события есть ≥1 снимок версии — клиент рисует часы-кнопку «История версий».
  readonly hasVersions: boolean;
};

// Сводка для hover-тултипа кнопки активности: когда/кем создан + когда/кем последний раз менялся.
export type ProjectActivitySummary = {
  readonly createdAt: Date;
  readonly createdByName: string | null;
  readonly lastEditedAt: Date | null;
  readonly lastEditedByName: string | null;
};

export type ProjectActivityResult = {
  readonly summary: ProjectActivitySummary;
  readonly items: ProjectActivityItem[];
};

type Deps = ProjectAccessDeps & {
  readonly activity: ActivityRepository;
  readonly users: UserRepository;
  readonly taskVersions: TaskVersionRepository;
};

// Активность конкретного проекта (окно активности): список событий с резолвом имён +
// сводка «создан/изменён». Гейт — участник проекта (read_project).
export class GetProjectActivity {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    userId: string,
    opts: { before?: Date; limit: number },
  ): Promise<ProjectActivityResult> {
    const { project } = await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    const events = await this.deps.activity.listForProject(projectId, opts);

    // Резолвим имена акторов/таргетов + владельца проекта (для «создан»).
    const ids = new Set<string>([project.ownerId]);
    for (const e of events) {
      if (e.actorUserId) ids.add(e.actorUserId);
      const target = e.payload?.targetUserId;
      if (target) ids.add(target);
    }
    const users = ids.size > 0 ? await this.deps.users.getManyByIds([...ids]) : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    // Кнопка «История версий» на событии — только если у задачи реально есть снимки. Собираем
    // taskId'ы событий и одним запросом узнаём, у каких есть версии (как в workspace-ленте).
    const taskIds = new Set<string>();
    for (const e of events) {
      if (e.payload?.taskId) taskIds.add(e.payload.taskId);
    }
    const withVersions =
      taskIds.size > 0 ? await this.deps.taskVersions.taskIdsWithVersions([...taskIds]) : new Set<string>();

    const items: ProjectActivityItem[] = events.map((e) => {
      const actor = e.actorUserId ? byId.get(e.actorUserId) : null;
      const target = e.payload?.targetUserId ? byId.get(e.payload.targetUserId) : null;
      return {
        id: e.id,
        kind: e.kind,
        projectId: e.projectId,
        actorUserId: e.actorUserId,
        actorDisplayName: actor?.displayName ?? null,
        actorAvatarUrl: actor?.avatarUrl ?? null,
        targetDisplayName: target?.displayName ?? null,
        payload: e.payload,
        createdAt: e.createdAt,
        hasVersions: !!e.payload?.taskId && withVersions.has(e.payload.taskId),
      };
    });

    // Последнее событие (события пришли DESC) → «изменён». Владелец + createdAt → «создан».
    const latest = events[0] ?? null;
    const summary: ProjectActivitySummary = {
      createdAt: project.createdAt,
      createdByName: byId.get(project.ownerId)?.displayName ?? null,
      lastEditedAt: latest?.createdAt ?? null,
      lastEditedByName: latest?.actorUserId ? (byId.get(latest.actorUserId)?.displayName ?? null) : null,
    };

    return { summary, items };
  }
}
