import { Router, type Request, type Response, type NextFunction } from 'express';
import type { GetPublicBoard } from '../../application/project/GetPublicBoard.js';
import type { GetPublicTaskDetail } from '../../application/project/GetPublicTaskDetail.js';
import type { GetPublicTaskAccess } from '../../application/project/GetPublicTaskAccess.js';
import type { GetPublicAttachment } from '../../application/project/GetPublicAttachment.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import type { AttachmentStorage } from '../../application/task/AttachmentStorage.js';

type Deps = {
  readonly getPublicBoard: GetPublicBoard;
  readonly getPublicTaskDetail: GetPublicTaskDetail;
  readonly getPublicTaskAccess: GetPublicTaskAccess;
  readonly getPublicAttachment: GetPublicAttachment;
  readonly projects: ProjectRepository;
  readonly coverStorage: AttachmentStorage;
};

const COVER_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

// Анонимный (БЕЗ requireAuth) роутер публичной доски. Смонтирован на /api/public/boards.
// Доступ гейтится не membership'ом, а флагом is_public по slug (см. GetPublicBoard). Всегда
// 404, если доска не найдена/не опубликована — не палим существование приватных проектов.
export function publicBoardRouter(deps: Deps): Router {
  const router = Router();

  // Публичная доска по slug: шапка проекта + задачи по колонкам (без комментов/приватных полей).
  router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slug = req.params.slug;
      if (typeof slug !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const board = await deps.getPublicBoard.execute(slug);
      if (!board) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ board });
    } catch (e) {
      next(e);
    }
  });

  // Обложка-картинка опубликованной доски (аналог authed /api/projects/:id/cover/:file, но
  // гейт — «проект публичен по slug», а не membership). Ключ в хранилище берём из project.coverUrl.
  router.get('/:slug/cover', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slug = req.params.slug;
      if (typeof slug !== 'string') {
        res.status(404).end();
        return;
      }
      const project = await deps.projects.getBySlug(slug);
      if (!project || !project.isPublic || !project.coverUrl) {
        res.status(404).end();
        return;
      }
      // Только загруженный файл проекта: `/api/projects/<id>/cover/<uuid>.<ext>`.
      const m = project.coverUrl.match(
        /^\/api\/projects\/([a-f0-9-]+)\/cover\/([a-f0-9-]+\.(?:jpg|png|webp|gif|avif))$/i,
      );
      if (!m) {
        // Градиент/внешний URL — здесь нечего отдавать (клиент рендерит их сам).
        res.status(404).end();
        return;
      }
      const [, projectId, file] = m;
      const ext = file!.split('.').pop()!.toLowerCase();
      const stored = await deps.coverStorage.read(`covers/${projectId}/${file}`);
      if (!stored) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', COVER_MIME[ext] ?? 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Публичная обложка — можно кешировать публично (в отличие от authed-варианта).
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(stored.data);
    } catch (e) {
      next(e);
    }
  });

  // Read-only деталь задачи (тело + фото + комментарии) для окна на публичной доске.
  router.get('/:slug/tasks/:taskId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug, taskId } = req.params;
      if (typeof slug !== 'string' || typeof taskId !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const detail = await deps.getPublicTaskDetail.execute(slug, taskId);
      if (!detail) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ task: detail });
    } catch (e) {
      next(e);
    }
  });

  // Гейт отдельной страницы задачи /p/:slug/t/:taskId. Читает опциональную сессию (req.user
  // проставлен глобальным sessionFromCookie), возвращает projectId + факт членства.
  router.get('/:slug/tasks/:taskId/access', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug, taskId } = req.params;
      if (typeof slug !== 'string' || typeof taskId !== 'string') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const access = await deps.getPublicTaskAccess.execute(slug, taskId, req.user?.id ?? null);
      if (!access) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(access);
    } catch (e) {
      next(e);
    }
  });

  // Вложение-картинка задачи опубликованной доски (для <img> в теле/комментах). Гейт по is_public.
  router.get('/:slug/attachments/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug, id } = req.params;
      if (typeof slug !== 'string' || typeof id !== 'string') {
        res.status(404).end();
        return;
      }
      const result = await deps.getPublicAttachment.execute(slug, id);
      if (!result) {
        res.status(404).end();
        return;
      }
      const mime = result.attachment.mimeType;
      // Inline только для растровых картинок; всё прочее (в т.ч. SVG) — форсим download.
      const inlineOk = /^image\/(png|jpeg|webp|gif|avif)$/i.test(mime);
      res.setHeader('Content-Type', inlineOk ? mime : 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `${inlineOk ? 'inline' : 'attachment'}; filename="${encodeURIComponent(result.attachment.filename)}"`,
      );
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(result.data.data);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
