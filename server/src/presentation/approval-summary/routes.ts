import { Router } from 'express';
import type { GetApprovalSummary } from '../../application/approval-summary/GetApprovalSummary.js';
import { requireAuth } from '../middleware/requireAuth.js';

export type ApprovalSummaryRouterDeps = {
  readonly get: GetApprovalSummary;
};

// ИИ-сводка «что сделано» для карточки полки «На утверждении» (db/186). Маунтится под
// /api/projects; доступ — как к чтению самой задачи (cookie-сессия + проверка внутри
// use-case). Нет сводки (задача не на утверждении, подписка ИИ недоступна) — 200 с null.
export function approvalSummaryRouter(deps: ApprovalSummaryRouterDeps): Router {
  const router = Router();

  // requireAuth — на самом маршруте, а не router.use: роутер висит на общем /api/projects
  // и не должен требовать сессию от чужих путей под этим префиксом.
  router.get('/:projectId/tasks/:taskId/approval-summary', requireAuth, async (req, res, next) => {
    try {
      const result = await deps.get.execute(
        req.params['projectId'] as string,
        req.user!.id,
        req.params['taskId'] as string,
      );
      res.json({ summary: result.summary, generatedAt: result.generatedAt?.toISOString() ?? null });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
