import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { RecordProjectView } from '../../application/project/RecordProjectView.js';
import type { GetProjectViewsAnalytics } from '../../application/project/GetProjectViewsAnalytics.js';
import type { GetProjectActivity, ProjectActivityResult } from '../../application/project/GetProjectActivity.js';
import type { ProjectAnalytics, ProjectViewer } from '../../domain/project/ProjectView.js';

type Deps = {
  readonly record: RecordProjectView;
  readonly getAnalytics: GetProjectViewsAnalytics;
  readonly getActivity: GetProjectActivity;
};

function activityToDto(r: ProjectActivityResult): unknown {
  return {
    summary: {
      createdAt: r.summary.createdAt.toISOString(),
      createdByName: r.summary.createdByName,
      lastEditedAt: r.summary.lastEditedAt?.toISOString() ?? null,
      lastEditedByName: r.summary.lastEditedByName,
    },
    items: r.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
    hasMore: r.hasMore,
    nextCursor: r.nextCursor
      ? { createdAt: r.nextCursor.createdAt.toISOString(), id: r.nextCursor.id }
      : null,
  };
}

type ViewerDto = Omit<ProjectViewer, 'lastViewedAt'> & { lastViewedAt: string };
type AnalyticsDto = Omit<ProjectAnalytics, 'viewers'> & { viewers: ViewerDto[] };

function toDto(a: ProjectAnalytics): AnalyticsDto {
  return {
    ...a,
    viewers: a.viewers.map((v) => ({ ...v, lastViewedAt: v.lastViewedAt.toISOString() })),
  };
}

// Аналитика просмотров проекта. Монтируется под /api/projects.
export function projectAnalyticsRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  // Записать просмотр (fire-and-forget с клиента при открытии проекта).
  router.post('/:projectId/views', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.record.execute(req.params['projectId'] as string, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Аналитика: суммарные просмотры + разбивка по дням + зрители.
  router.get('/:projectId/analytics', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = Number(req.query['days'] ?? 28);
      const analytics = await deps.getAnalytics.execute(
        req.params['projectId'] as string,
        req.user!.id,
        days,
      );
      res.json({ analytics: toDto(analytics) });
    } catch (e) {
      next(e);
    }
  });

  // Активность проекта: список событий + сводка «создан/изменён» (для окна и hover-тултипа).
  router.get('/:projectId/activity', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limitParam = Number(req.query['limit'] ?? 30);
      const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, limitParam)) : 30;
      const beforeParam = req.query['before'];
      const beforeIdParam = req.query['beforeId'];
      const before = typeof beforeParam === 'string' ? new Date(beforeParam) : undefined;
      const result = await deps.getActivity.execute(req.params['projectId'] as string, req.user!.id, {
        limit,
        before: before && !Number.isNaN(before.getTime()) ? before : undefined,
        beforeId: typeof beforeIdParam === 'string' ? beforeIdParam : undefined,
      });
      res.json(activityToDto(result));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
