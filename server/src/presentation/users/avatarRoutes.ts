import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AttachmentStorage } from '../../application/task/AttachmentStorage.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly storage: AttachmentStorage;
};

// Content-Type по расширению (storage не хранит mime). SVG отдаём как octet-stream
// (анти-XSS) — он просто не отрисуется как <img>, будет фолбэк на инициалы.
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

// Простые сегменты пути (uuid + ext, userId). Защищает от traversal ещё до storage.resolve.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

// Отдача аватаров: GET /api/avatars/:userId/:file. Auth-gated (аватары не секретны, но
// доступны только залогиненным). URL сам кодирует storage-key avatars/{userId}/{file}.
export function avatarRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:userId/:file', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params['userId'] as string;
      const file = req.params['file'] as string;
      if (!SAFE_SEGMENT.test(userId) || !SAFE_SEGMENT.test(file)) {
        res.status(400).end();
        return;
      }
      const result = await deps.storage.read(`avatars/${userId}/${file}`);
      if (!result) {
        res.status(404).end();
        return;
      }
      const ext = (file.split('.').pop() ?? '').toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.setHeader('Content-Length', result.data.byteLength.toString());
      res.send(result.data);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
