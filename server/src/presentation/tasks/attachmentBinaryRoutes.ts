import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GetTaskAttachment } from '../../application/task/GetTaskAttachment.js';
import { verifyAttachmentToken } from '../../application/attachments/signedAttachmentUrl.js';
import { contentDisposition } from '../contentDisposition.js';
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

// MP4 is the only video format we currently preview inline. Keeping the allow-list narrow is
// intentional: unlike arbitrary uploads, MP4 is passive media and is safe to expose to a
// same-origin <video> element with nosniff enabled.
function inlineVideoMime(mimeType: string, filename: string): string | null {
  if (mimeType.split(';', 1)[0]?.trim().toLowerCase() === 'video/mp4') return 'video/mp4';
  return filename.toLowerCase().endsWith('.mp4') ? 'video/mp4' : null;
}

type ByteRange = { readonly start: number; readonly end: number };

function parseSingleByteRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0 || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

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
      // - inline только для растровых картинок и MP4 (нужно для превью); SVG и всё остальное —
      //   принудительно скачиванием (SVG может нести скрипт; html/прочее — тоже).
      // Медиа определяем по mimeType ИЛИ по расширению (фолбэк для криво сохранённого MIME).
      const imageMime = inlineImageMime(attachment.mimeType, attachment.filename);
      const videoMime = inlineVideoMime(attachment.mimeType, attachment.filename);
      const inlineMime = imageMime ?? videoMime;
      const isInlineMedia = inlineMime !== null;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', inlineMime ?? 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        contentDisposition(attachment.filename, isInlineMedia),
      );
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

      if (videoMime) {
        const size = data.data.byteLength;
        res.setHeader('Accept-Ranges', 'bytes');
        const requestedRange = req.headers.range;
        if (requestedRange) {
          const range = parseSingleByteRange(requestedRange, size);
          if (!range) {
            res.setHeader('Content-Range', `bytes */${size}`);
            res.status(416).end();
            return;
          }
          const chunk = data.data.subarray(range.start, range.end + 1);
          res.status(206);
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
          res.setHeader('Content-Length', chunk.byteLength.toString());
          res.send(chunk);
          return;
        }
      }

      res.setHeader('Content-Length', data.data.byteLength.toString());
      res.send(data.data);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
