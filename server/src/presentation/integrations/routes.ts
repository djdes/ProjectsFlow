import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ManageWebhooks } from '../../application/integrations/ManageWebhooks.js';
import {
  WebhookEventsInvalidError,
  WebhookLimitError,
  WebhookNotFoundError,
  WebhookUrlInvalidError,
} from '../../domain/integrations/ProjectWebhook.js';

export type IntegrationsRouterDeps = {
  readonly webhooks: ManageWebhooks;
};

// Маппинг доменных ошибок вебхуков на HTTP. Локально в роуте, чтобы не трогать общий
// errorHandler (чужой файл). Возвращает true, если ошибка обработана.
function handleWebhookError(error: unknown, res: import('express').Response): boolean {
  if (error instanceof WebhookUrlInvalidError) {
    res.status(400).json({ error: 'invalid_webhook_url', message: 'Укажите корректный HTTPS-адрес без логина/пароля.' });
    return true;
  }
  if (error instanceof WebhookEventsInvalidError) {
    res.status(400).json({ error: 'invalid_webhook_events', message: 'Выберите хотя бы одно поддерживаемое событие.' });
    return true;
  }
  if (error instanceof WebhookLimitError) {
    res.status(409).json({ error: 'webhook_limit_reached', message: `Достигнут лимит вебхуков (${error.limit}).` });
    return true;
  }
  if (error instanceof WebhookNotFoundError) {
    res.status(404).json({ error: 'webhook_not_found', message: 'Вебхук не найден.' });
    return true;
  }
  return false;
}

// Исходящие вебхуки проекта (срез 6). Cookie-auth, доступ по проекту проверяется в ManageWebhooks
// (update_project). Маунтится под /api/projects как .../:projectId/integrations/webhooks.
export function integrationsRouter(deps: IntegrationsRouterDeps): Router {
  const router = Router();

  router.get('/:projectId/integrations/webhooks', requireAuth, async (req, res, next) => {
    try {
      const webhooks = await deps.webhooks.list(req.params['projectId'] as string, req.user!.id);
      res.status(200).json({ webhooks });
    } catch (error) {
      if (handleWebhookError(error, res)) return;
      next(error);
    }
  });

  router.post('/:projectId/integrations/webhooks', requireAuth, async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { url?: unknown; events?: unknown };
      // Ответ содержит секрет — он больше нигде не появится (показ ОДИН раз, раздел 4 плана).
      const created = await deps.webhooks.create(req.params['projectId'] as string, req.user!.id, {
        url: body.url,
        events: body.events,
      });
      res.status(201).json(created);
    } catch (error) {
      if (handleWebhookError(error, res)) return;
      next(error);
    }
  });

  router.patch('/:projectId/integrations/webhooks/:id', requireAuth, async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { url?: unknown; events?: unknown; enabled?: unknown };
      const updated = await deps.webhooks.update(
        req.params['projectId'] as string,
        req.user!.id,
        req.params['id'] as string,
        { url: body.url, events: body.events, enabled: body.enabled },
      );
      res.status(200).json({ webhook: updated });
    } catch (error) {
      if (handleWebhookError(error, res)) return;
      next(error);
    }
  });

  router.delete('/:projectId/integrations/webhooks/:id', requireAuth, async (req, res, next) => {
    try {
      await deps.webhooks.remove(
        req.params['projectId'] as string,
        req.user!.id,
        req.params['id'] as string,
      );
      res.status(204).end();
    } catch (error) {
      if (handleWebhookError(error, res)) return;
      next(error);
    }
  });

  router.post('/:projectId/integrations/webhooks/:id/test', requireAuth, async (req, res, next) => {
    try {
      const result = await deps.webhooks.test(
        req.params['projectId'] as string,
        req.user!.id,
        req.params['id'] as string,
      );
      res.status(200).json(result);
    } catch (error) {
      if (handleWebhookError(error, res)) return;
      next(error);
    }
  });

  return router;
}
