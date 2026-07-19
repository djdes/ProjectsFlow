import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { GetActivityFeed } from '../../application/activity/GetActivityFeed.js';
import type { WorkspaceRepository } from '../../application/workspace/WorkspaceRepository.js';
import type { UserRepository } from '../../application/user/UserRepository.js';
import type { TaskVersionRepository } from '../../application/task/TaskVersionRepository.js';
import type { TaskRepository } from '../../application/task/TaskRepository.js';
import { notificationTaskId, type Notification } from '../../domain/notifications/Notification.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspaceMember } from '../../application/workspace/workspaceAccess.js';

type Deps = {
  readonly getFeed: GetActivityFeed;
  readonly workspaces: WorkspaceRepository;
  readonly users: UserRepository;
  readonly taskVersions: TaskVersionRepository;
  readonly tasks: TaskRepository;
};

const querySchema = z.object({
  tab: z.enum(['all', 'action']).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

// Уведомление сериализуем 1-в-1 как /api/notifications — клиент парсит той же логикой.
function notifDto(n: Notification, deletedTaskIds: ReadonlySet<string>): unknown {
  const taskId = notificationTaskId(n.payload);
  return {
    ...n,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
    taskDeleted: taskId !== null && deletedTaskIds.has(taskId),
  };
}

// GET /api/workspaces/:workspaceId/feed?tab=all|action&before=&limit=
export function activityFeedRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const workspaceId = req.params.workspaceId as string;
      await requireWorkspaceMember(deps.workspaces, workspaceId, userId);

      const q = querySchema.parse(req.query);
      const limit = q.limit ?? 30;
      const before = q.before ? new Date(q.before) : undefined;
      const items = await deps.getFeed.execute(userId, workspaceId, {
        tab: q.tab ?? 'all',
        before,
        limit,
      });

      // Обогащение display-name/avatar актора и target'а (резолв на чтении — имена свежие).
      const userIds = new Set<string>();
      for (const it of items) {
        if (it.type === 'activity') {
          if (it.event.actorUserId) userIds.add(it.event.actorUserId);
          const t = it.event.payload?.targetUserId;
          if (t) userIds.add(t);
        }
      }
      const users = userIds.size > 0 ? await deps.users.getManyByIds([...userIds]) : [];
      const byId = new Map(users.map((u) => [u.id, u]));

      // Кнопка «История версий» на событии должна появляться ТОЛЬКО если у задачи реально есть
      // версии (старые задачи до фичи версий их не имеют). Собираем taskId'ы событий и одним
      // запросом узнаём, у каких из них есть снимки — клиент по hasVersions решает, рисовать ли часы.
      const taskIds = new Set<string>();
      // Ссылки на задачу есть и у событий, и у уведомлений — сверяем с живыми задачами разом:
      // лента и колокольчик не джойнятся с tasks, и ссылка на удалённую вела бы в 404.
      const linkedTaskIds = new Set<string>();
      for (const it of items) {
        if (it.type === 'activity') {
          if (it.event.payload?.taskId) {
            taskIds.add(it.event.payload.taskId);
            linkedTaskIds.add(it.event.payload.taskId);
          }
          continue;
        }
        const notifTaskId = notificationTaskId(it.notification.payload);
        if (notifTaskId) linkedTaskIds.add(notifTaskId);
      }
      const [withVersions, deletedTaskIds] = await Promise.all([
        taskIds.size > 0 ? deps.taskVersions.taskIdsWithVersions([...taskIds]) : new Set<string>(),
        deps.tasks.findDeletedTaskIds([...linkedTaskIds]),
      ]);

      const dto = items.map((it) => {
        if (it.type === 'notification') {
          return {
            type: 'notification' as const,
            createdAt: it.createdAt.toISOString(),
            notification: notifDto(it.notification, deletedTaskIds),
          };
        }
        const e = it.event;
        const actor = e.actorUserId ? byId.get(e.actorUserId) : null;
        const target = e.payload?.targetUserId ? byId.get(e.payload.targetUserId) : null;
        return {
          type: 'activity' as const,
          createdAt: e.createdAt.toISOString(),
          id: e.id,
          kind: e.kind,
          projectId: e.projectId,
          actorUserId: e.actorUserId,
          actorDisplayName: actor?.displayName ?? null,
          actorAvatarUrl: actor?.avatarUrl ?? null,
          targetDisplayName: target?.displayName ?? null,
          payload: e.payload,
          hasVersions: !!e.payload?.taskId && withVersions.has(e.payload.taskId),
          taskDeleted: !!e.payload?.taskId && deletedTaskIds.has(e.payload.taskId),
        };
      });

      const nextBefore = dto.length === limit ? dto[dto.length - 1]!.createdAt : null;
      res.json({ items: dto, nextBefore });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
