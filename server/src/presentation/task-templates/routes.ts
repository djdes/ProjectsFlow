import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ManageWorkspaceTaskTemplates } from '../../application/task/ManageWorkspaceTaskTemplates.js';
import type { WorkspaceTaskTemplate } from '../../domain/task/WorkspaceTaskTemplate.js';
import { taskRecurrenceSchema } from '../tasks/schemas.js';

export type WorkspaceTaskTemplatesRouterDeps = {
  readonly manage: ManageWorkspaceTaskTemplates;
};

// «Сохранить как шаблон»: текст задачи (с чеклистом), приоритет, тип и повтор.
const createTemplateSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().min(1, 'Введите текст задачи').max(50000),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  taskType: z.enum(['feature', 'bug']).nullable().optional(),
  recurrence: taskRecurrenceSchema.optional(),
});

function toDto(t: WorkspaceTaskTemplate) {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    name: t.name,
    description: t.description,
    priority: t.priority,
    taskType: t.taskType,
    recurrence: t.recurrence,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
  };
}

// Шаблоны задач пространства (db/187). Маунтится под /api/workspaces, подпути
// /:workspaceId/task-templates — не пересекаются с остальными роутами пространства.
export function workspaceTaskTemplatesRouter(deps: WorkspaceTaskTemplatesRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get('/:workspaceId/task-templates', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const templates = await deps.manage.list(req.params['workspaceId'] as string, req.user!.id);
      res.json({ templates: templates.map(toDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:workspaceId/task-templates', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createTemplateSchema.parse(req.body);
      const template = await deps.manage.create({
        workspaceId: req.params['workspaceId'] as string,
        userId: req.user!.id,
        name: body.name ?? null,
        description: body.description,
        priority: body.priority ?? null,
        taskType: body.taskType ?? null,
        recurrence: body.recurrence ?? null,
      });
      res.status(201).json({ template: toDto(template) });
    } catch (e) {
      next(e);
    }
  });

  router.delete(
    '/:workspaceId/task-templates/:templateId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await deps.manage.remove(
          req.params['workspaceId'] as string,
          req.params['templateId'] as string,
          req.user!.id,
        );
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
