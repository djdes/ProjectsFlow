import { Router, raw, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { FileSyncService, SnapshotSource } from '../../application/file-sync/FileSyncService.js';
import type { SessionStatus } from '../../application/file-sync/FileSyncRepository.js';

export type FileSyncRouterDeps = {
  readonly service: FileSyncService;
  readonly authenticate: AuthenticateAgentToken;
  readonly maxBlobBytes: number;
};

const sourceSchema = z.enum(['client', 'dispatcher']);

const entrySchema = z.object({
  path: z.string().min(1).max(1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  size: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative(),
  mtimeMs: z.number().int().nullable().optional(),
  isSymlink: z.boolean().optional(),
  symlinkTarget: z.string().max(1024).nullable().optional(),
});

const createDraftSchema = z.object({
  source: sourceSchema,
  entries: z.array(entrySchema).max(200_000),
  taskId: z.string().nullable().optional(),
  parentSnapshotId: z.string().nullable().optional(),
});

const sealSchema = z.object({ source: sourceSchema });
const openSessionSchema = z.object({
  baseSnapshotId: z.string(),
  taskId: z.string().nullable().optional(),
  idempotencyKey: z.string().max(128).nullable().optional(),
});
const resultSchema = z.object({ resultSnapshotId: z.string() });
const ackSchema = z.object({
  outcome: z.enum(['applied', 'conflict', 'partial']),
  conflicts: z.unknown().optional(),
});
const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        seq: z.number().int().nonnegative(),
        kind: z.string().max(32),
        text: z.string().nullable().optional(),
        payload: z.unknown().optional(),
      }),
    )
    .max(64),
});
const workspaceSchema = z.object({ label: z.string().max(255).nullable().optional() });

function pid(req: Request): string {
  return req.params['projectId'] as string;
}
function uid(req: Request): string {
  return req.user!.id;
}
function isDispatcher(req: Request): boolean {
  return req.query['as'] === 'dispatcher';
}

// Все /api/agent/.../sync/* и .../events маршруты. Bearer-auth тот же, что у agentApiRouter.
export function fileSyncRouter(deps: FileSyncRouterDeps): Router {
  const router = Router();
  router.use(requireAgentToken(deps.authenticate));
  const svc = deps.service;

  router.post('/projects/:projectId/sync/workspace', async (req, res, next) => {
    try {
      const body = workspaceSchema.parse(req.body ?? {});
      const out = await svc.ensureWorkspace(pid(req), uid(req), body.label ?? null);
      res.status(201).json(out);
    } catch (e) {
      next(e);
    }
  });

  router.get('/projects/:projectId/sync/workspace', async (req, res, next) => {
    try {
      const ws = await svc.getWorkspace(pid(req), uid(req));
      res.json({ workspace: ws });
    } catch (e) {
      next(e);
    }
  });

  router.post('/projects/:projectId/sync/snapshots', async (req, res, next) => {
    try {
      const body = createDraftSchema.parse(req.body);
      const out = await svc.createSnapshotDraft(pid(req), uid(req), {
        source: body.source as SnapshotSource,
        entries: body.entries.map((e) => ({
          path: e.path,
          sha256: e.sha256,
          size: e.size,
          mode: e.mode,
          mtimeMs: e.mtimeMs ?? null,
          isSymlink: e.isSymlink ?? false,
          symlinkTarget: e.symlinkTarget ?? null,
        })),
        taskId: body.taskId ?? null,
        parentSnapshotId: body.parentSnapshotId ?? null,
      });
      res.status(201).json(out);
    } catch (e) {
      next(e);
    }
  });

  // Загрузка блоба сырыми байтами (любой content-type). sha в пути, source в query.
  router.put(
    '/projects/:projectId/sync/blobs/:sha256',
    raw({ type: () => true, limit: deps.maxBlobBytes + 1024 }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sha = req.params['sha256'] as string;
        const source = sourceSchema.parse(req.query['source'] ?? 'client');
        const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        await svc.uploadBlob(pid(req), uid(req), sha, data, source);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  router.post('/projects/:projectId/sync/snapshots/:sid/seal', async (req, res, next) => {
    try {
      const body = sealSchema.parse(req.body);
      const out = await svc.sealSnapshot(pid(req), uid(req), req.params['sid'] as string, body.source as SnapshotSource);
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  router.get('/projects/:projectId/sync/snapshots/:sid/manifest', async (req, res, next) => {
    try {
      const entries = await svc.getManifest(pid(req), uid(req), req.params['sid'] as string, isDispatcher(req));
      res.json({ entries });
    } catch (e) {
      next(e);
    }
  });

  router.get('/projects/:projectId/sync/blobs/:sha256', async (req, res, next) => {
    try {
      const snapshotId = z.string().parse(req.query['snapshotId']);
      const data = await svc.getBlob(pid(req), uid(req), snapshotId, req.params['sha256'] as string, isDispatcher(req));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(data);
    } catch (e) {
      next(e);
    }
  });

  router.post('/projects/:projectId/sync/sessions', async (req, res, next) => {
    try {
      const body = openSessionSchema.parse(req.body);
      const session = await svc.openSession(pid(req), uid(req), {
        baseSnapshotId: body.baseSnapshotId,
        taskId: body.taskId ?? null,
        idempotencyKey: body.idempotencyKey ?? null,
      });
      res.status(201).json({ session });
    } catch (e) {
      next(e);
    }
  });

  router.get('/projects/:projectId/sync/sessions', async (req, res, next) => {
    try {
      const statusesRaw = typeof req.query['status'] === 'string' ? (req.query['status'] as string) : '';
      const statuses = statusesRaw.split(',').map((s) => s.trim()).filter(Boolean) as SessionStatus[];
      const taskId = typeof req.query['taskId'] === 'string' ? (req.query['taskId'] as string) : null;
      const sessions = await svc.listSessions(pid(req), uid(req), statuses, taskId);
      res.json({ sessions });
    } catch (e) {
      next(e);
    }
  });

  router.post('/projects/:projectId/sync/sessions/:sid/result', async (req, res, next) => {
    try {
      const body = resultSchema.parse(req.body);
      const out = await svc.recordSnapshotResult(pid(req), uid(req), req.params['sid'] as string, body.resultSnapshotId);
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  router.get('/projects/:projectId/sync/change-sets', async (req, res, next) => {
    try {
      const base = z.string().parse(req.query['base']);
      const head = z.string().parse(req.query['head']);
      const out = await svc.getChangeSet(pid(req), uid(req), base, head);
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  router.post('/projects/:projectId/sync/sessions/:sid/ack', async (req, res, next) => {
    try {
      const body = ackSchema.parse(req.body);
      const out = await svc.ackSession(pid(req), uid(req), req.params['sid'] as string, body.outcome, body.conflicts);
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  router.post('/projects/:projectId/tasks/:taskId/events', async (req, res, next) => {
    try {
      const body = eventsSchema.parse(req.body);
      const out = await svc.appendProgressEvents(pid(req), uid(req), req.params['taskId'] as string, body.events);
      res.status(201).json(out);
    } catch (e) {
      next(e);
    }
  });

  router.get('/projects/:projectId/tasks/:taskId/events', async (req, res, next) => {
    try {
      const since = Number(req.query['since'] ?? 0) || 0;
      const limit = Math.min(Number(req.query['limit'] ?? 200) || 200, 1000);
      const out = await svc.listProgressEvents(pid(req), uid(req), req.params['taskId'] as string, since, limit);
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
