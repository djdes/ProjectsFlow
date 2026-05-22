import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GetTaskAttachment } from '../../application/task/GetTaskAttachment.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly getAttachment: GetTaskAttachment;
};

// Auth-gated binary endpoint для аттачей: /api/attachments/:id. Отдельный mount-prefix
// (не под /api/projects/:projectId/tasks/:taskId/...) — клиенту хочется коротких URL'ов
// в <img src=...>, плюс юзер обычно не знает projectId/taskId аттача (например, в
// description есть markdown-link).
export function attachmentBinaryRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;
      const { attachment, data } = await deps.getAttachment.execute(req.user!.id, id);

      // Любой тип файла разрешён к загрузке, поэтому отдаём безопасно:
      // - nosniff, чтобы браузер не «угадывал» MIME (анти-XSS на same-origin).
      // - inline только для растровых картинок (нужно для превью); SVG и всё остальное —
      //   принудительно скачиванием (SVG может нести скрипт; html/прочее — тоже).
      const isInlineImage =
        attachment.mimeType.startsWith('image/') && attachment.mimeType !== 'image/svg+xml';
      // RFC5987-имя: кириллица ок, вырезаем CR/LF/кавычки/backslash.
      const safeName = attachment.filename.replace(/[\r\n"\\]/g, '_');
      const encodedName = encodeURIComponent(attachment.filename).replace(/['()]/g, escape);

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', isInlineImage ? attachment.mimeType : 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `${isInlineImage ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      );
      res.setHeader('Content-Length', data.data.byteLength.toString());
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.send(data.data);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
