import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ChatService, SendAttachmentDescriptor } from '../../application/chat/ChatService.js';
import type { ChatEventHub } from '../../infrastructure/realtime/ChatEventHub.js';
import type { AttachmentStorage } from '../../application/task/AttachmentStorage.js';
import type { ChatStreamEvent } from '../../domain/chat/ChatEvent.js';
import { editMessageSchema, reactionSchema, markReadSchema } from './schemas.js';

export type ChatRouterDeps = {
  readonly service: ChatService;
  readonly chatEventHub: ChatEventHub;
  readonly storage: AttachmentStorage;
  readonly idGen: () => string;
  readonly maxAttachmentBytes: number;
};

function wid(req: Request): string {
  return req.params['workspaceId'] as string;
}
function uid(req: Request): string {
  return req.user!.id;
}

// Безопасное расширение из имени файла (для storageKey). Любой тип разрешён.
function extFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return 'bin';
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : 'bin';
}

// Чат пространства (cookie requireAuth + requireWorkspaceMember внутри ChatService).
// Маунтится под /api/workspaces.
export function chatRouter(deps: ChatRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);
  const svc = deps.service;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxAttachmentBytes },
  });

  router.get('/:workspaceId/chat/messages', async (req, res, next) => {
    try {
      const beforeSeq = req.query['beforeSeq'] !== undefined ? Number(req.query['beforeSeq']) : undefined;
      const afterSeq = req.query['afterSeq'] !== undefined ? Number(req.query['afterSeq']) : undefined;
      const limit = req.query['limit'] !== undefined ? Number(req.query['limit']) : undefined;
      const messages = await svc.listMessages(wid(req), uid(req), {
        ...(beforeSeq !== undefined && !Number.isNaN(beforeSeq) ? { beforeSeq } : {}),
        ...(afterSeq !== undefined && !Number.isNaN(afterSeq) ? { afterSeq } : {}),
        ...(limit !== undefined && !Number.isNaN(limit) ? { limit } : {}),
      });
      res.json({ messages });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/:workspaceId/chat/messages',
    upload.array('files', 10),
    async (req, res, next) => {
      try {
        const workspaceId = wid(req);
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        const attachments: SendAttachmentDescriptor[] = [];
        for (const f of files) {
          const storageKey = `chat/${workspaceId}/${deps.idGen()}.${extFromFilename(f.originalname)}`;
          await deps.storage.put({ storageKey, data: f.buffer, mimeType: f.mimetype });
          attachments.push({
            storageKey,
            filename: f.originalname.slice(0, 255),
            mimeType: f.mimetype,
            sizeBytes: f.size,
          });
        }
        const bodyRaw = typeof req.body?.body === 'string' ? req.body.body : '';
        const replyToIdRaw = typeof req.body?.replyToId === 'string' && req.body.replyToId.length > 0
          ? req.body.replyToId
          : null;
        const message = await svc.sendMessage(workspaceId, uid(req), {
          body: bodyRaw,
          replyToId: replyToIdRaw,
          attachments,
        });
        res.status(201).json({ message });
      } catch (e) {
        next(e);
      }
    },
  );

  router.patch('/:workspaceId/chat/messages/:id', async (req, res, next) => {
    try {
      const { body } = editMessageSchema.parse(req.body);
      const message = await svc.editMessage(wid(req), uid(req), req.params['id'] as string, body);
      res.json({ message });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:workspaceId/chat/messages/:id', async (req, res, next) => {
    try {
      await svc.deleteMessage(wid(req), uid(req), req.params['id'] as string);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/:workspaceId/chat/messages/:id/reactions', async (req, res, next) => {
    try {
      const { emoji } = reactionSchema.parse(req.body);
      await svc.toggleReaction(wid(req), uid(req), req.params['id'] as string, emoji, true);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:workspaceId/chat/messages/:id/reactions/:emoji', async (req, res, next) => {
    try {
      const emoji = decodeURIComponent(req.params['emoji'] as string);
      await svc.toggleReaction(wid(req), uid(req), req.params['id'] as string, emoji, false);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/:workspaceId/chat/read', async (req, res, next) => {
    try {
      const { lastReadSeq } = markReadSchema.parse(req.body);
      await svc.markRead(wid(req), uid(req), lastReadSeq);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/:workspaceId/chat/unread', async (req, res, next) => {
    try {
      const count = await svc.getUnreadCount(wid(req), uid(req));
      res.json({ count });
    } catch (e) {
      next(e);
    }
  });

  // Бинарь вложения (auth + участник пространства; вложение принадлежит сообщению этого ws).
  router.get('/:workspaceId/chat/attachments/:id', async (req, res, next) => {
    try {
      const att = await svc.authorizeAttachment(wid(req), uid(req), req.params['id'] as string);
      const data = await deps.storage.read(att.storageKey);
      if (!data) {
        res.status(404).json({ error: 'chat_attachment_not_found' });
        return;
      }
      const isInlineImage =
        att.mimeType.startsWith('image/') && att.mimeType !== 'image/svg+xml';
      const safeName = att.filename.replace(/[\r\n"\\]/g, '_');
      const encodedName = encodeURIComponent(att.filename).replace(/['()]/g, escape);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', isInlineImage ? att.mimeType : 'application/octet-stream');
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

  // SSE: гейт доступа ДО writeHead → replay (seq > afterSeq) → subscribe ChatEventHub(ws).
  // Заголовки/heartbeat — копия live/routes.ts.
  router.get('/:workspaceId/chat/stream', async (req, res, next) => {
    const workspaceId = wid(req);
    try {
      await svc.assertMember(workspaceId, uid(req));
    } catch (e) {
      next(e);
      return;
    }

    const afterSeqStart = Number(req.query['afterSeq'] ?? 0) || 0;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const writeEvent = (e: ChatStreamEvent): void => {
      res.write(`event: chat\ndata: ${JSON.stringify(e)}\n\n`);
    };

    let closed = false;
    const buffered: ChatStreamEvent[] = [];
    let replaying = true;
    const unsubscribe = deps.chatEventHub.subscribe(workspaceId, (event) => {
      if (replaying) {
        buffered.push(event);
        return;
      }
      writeEvent(event);
    });

    let lastReplayedSeq = afterSeqStart;
    try {
      const PAGE = 100;
      for (;;) {
        const page = await svc.listMessages(workspaceId, uid(req), {
          afterSeq: lastReplayedSeq,
          limit: PAGE,
        });
        if (page.length === 0) break;
        for (const m of page) {
          writeEvent({ kind: 'message_added', message: m });
          if (m.seq > lastReplayedSeq) lastReplayedSeq = m.seq;
        }
        if (page.length < PAGE) break;
      }
    } catch {
      if (!closed) {
        closed = true;
        unsubscribe();
        res.end();
      }
      return;
    }

    replaying = false;
    // dedup: события из буфера с seq уже отданными в replay пропускаем (по message.seq).
    for (const e of buffered) {
      if (e.kind === 'message_added' && e.message.seq <= lastReplayedSeq) continue;
      writeEvent(e);
    }
    buffered.length = 0;

    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
