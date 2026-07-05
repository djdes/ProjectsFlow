import { Router, type Request, type Response, type NextFunction } from 'express';
import type { GetPublicBoard } from '../../application/project/GetPublicBoard.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import type { AttachmentStorage } from '../../application/task/AttachmentStorage.js';

type Deps = {
  readonly getPublicBoard: GetPublicBoard;
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

  return router;
}
