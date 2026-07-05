import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GetTaskAttachment } from '../../application/task/GetTaskAttachment.js';
import { verifyAttachmentToken } from '../../application/attachments/signedAttachmentUrl.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly getAttachment: GetTaskAttachment;
  // Секрет для проверки подписанных URL картинок (письмо/Telegram — без сессии).
  readonly signingSecret: string;
};

// Растровые расширения → image-MIME. Фолбэк, когда сохранённый mimeType пустой/кривой
// (часто у .webp и файлов из мессенджеров): иначе отдали бы octet-stream + nosniff,
// и браузер отказался бы рисовать <img>. SVG сюда НЕ включаем (анти-XSS — только download).
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  apng: 'image/apng',
};

// Эффективный image-MIME для inline-отдачи: по mimeType, иначе по расширению имени.
// null → не картинка (отдаём как download).
function inlineImageMime(mimeType: string, filename: string): string | null {
  if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') return mimeType;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}

// Auth-gated binary endpoint для аттачей: /api/attachments/:id. Отдельный mount-prefix
// (не под /api/projects/:projectId/tasks/:taskId/...) — клиенту хочется коротких URL'ов
// в <img src=...>, плюс юзер обычно не знает projectId/taskId аттача (например, в
// description есть markdown-link).
export function attachmentBinaryRouter(deps: Deps): Router {
  const router = Router();

  // Гейт доступа: валидный подписанный токен (?e=&s=) → отдаём без сессии (письмо/Telegram).
  // Иначе — обычная сессионная авторизация (requireAuth + проверка членства).
  const gate = (req: Request, res: Response, next: NextFunction): void => {
    const { e, s } = req.query;
    if (
      typeof e === 'string' &&
      typeof s === 'string' &&
      verifyAttachmentToken(req.params['id'] as string, e, s, deps.signingSecret, Date.now())
    ) {
      res.locals['signedAttachment'] = true;
      next();
      return;
    }
    requireAuth(req, res, next);
  };

  router.get('/:id', gate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;
      const { attachment, data } = res.locals['signedAttachment']
        ? await deps.getAttachment.executeSigned(id)
        : await deps.getAttachment.execute(req.user!.id, id);

      // Любой тип файла разрешён к загрузке, поэтому отдаём безопасно:
      // - nosniff, чтобы браузер не «угадывал» MIME (анти-XSS на same-origin).
      // - inline только для растровых картинок (нужно для превью); SVG и всё остальное —
      //   принудительно скачиванием (SVG может нести скрипт; html/прочее — тоже).
      // Картинку определяем по mimeType ИЛИ по расширению (фолбэк для .webp с кривым MIME).
      const inlineMime = inlineImageMime(attachment.mimeType, attachment.filename);
      const isInlineImage = inlineMime !== null;
      // RFC5987-имя: кириллица ок, вырезаем CR/LF/кавычки/backslash.
      const safeName = attachment.filename.replace(/[\r\n"\\]/g, '_');
      const encodedName = encodeURIComponent(attachment.filename).replace(/['()]/g, escape);

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', isInlineImage ? inlineMime : 'application/octet-stream');
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
