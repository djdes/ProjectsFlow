import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ManageWorkflows } from '../../application/automation/ManageWorkflows.js';
import {
  WorkflowLimitError,
  WorkflowRuleInvalidError,
  WorkflowRuleNotFoundError,
} from '../../domain/automation/WorkflowRule.js';

export type WorkflowRouterDeps = {
  readonly workflows: ManageWorkflows;
};

// Маппинг доменных ошибок правил на HTTP. Локально в роуте, чтобы не трогать общий errorHandler.
function handleWorkflowError(error: unknown, res: import('express').Response): boolean {
  if (error instanceof WorkflowRuleInvalidError) {
    res.status(400).json({
      error: 'invalid_workflow_rule',
      message: 'Проверьте триггер и действие: допустимы только поддерживаемые типы и параметры.',
    });
    return true;
  }
  if (error instanceof WorkflowLimitError) {
    res.status(409).json({
      error: 'workflow_limit_reached',
      message: `Достигнут лимит правил автоматизации (${error.limit}).`,
    });
    return true;
  }
  if (error instanceof WorkflowRuleNotFoundError) {
    res.status(404).json({ error: 'workflow_rule_not_found', message: 'Правило не найдено.' });
    return true;
  }
  return false;
}

// Правила «событие → действие» проекта (срез 8). Cookie-auth; доступ по проекту проверяется в
// ManageWorkflows (update_project). Маунтится под /api/projects как .../:projectId/workflows.
export function workflowRouter(deps: WorkflowRouterDeps): Router {
  const router = Router();

  router.get('/:projectId/workflows', requireAuth, async (req, res, next) => {
    try {
      const workflows = await deps.workflows.list(req.params['projectId'] as string, req.user!.id);
      res.status(200).json({ workflows });
    } catch (error) {
      if (handleWorkflowError(error, res)) return;
      next(error);
    }
  });

  router.post('/:projectId/workflows', requireAuth, async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { name?: unknown; trigger?: unknown; action?: unknown };
      const created = await deps.workflows.create(req.params['projectId'] as string, req.user!.id, {
        name: body.name,
        trigger: body.trigger,
        action: body.action,
      });
      res.status(201).json({ workflow: created });
    } catch (error) {
      if (handleWorkflowError(error, res)) return;
      next(error);
    }
  });

  router.patch('/:projectId/workflows/:id', requireAuth, async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        name?: unknown;
        trigger?: unknown;
        action?: unknown;
        enabled?: unknown;
      };
      const updated = await deps.workflows.update(
        req.params['projectId'] as string,
        req.user!.id,
        req.params['id'] as string,
        { name: body.name, trigger: body.trigger, action: body.action, enabled: body.enabled },
      );
      res.status(200).json({ workflow: updated });
    } catch (error) {
      if (handleWorkflowError(error, res)) return;
      next(error);
    }
  });

  router.delete('/:projectId/workflows/:id', requireAuth, async (req, res, next) => {
    try {
      await deps.workflows.remove(
        req.params['projectId'] as string,
        req.user!.id,
        req.params['id'] as string,
      );
      res.status(204).end();
    } catch (error) {
      if (handleWorkflowError(error, res)) return;
      next(error);
    }
  });

  return router;
}
