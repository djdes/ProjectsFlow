import { Router, type NextFunction, type Request, type Response } from 'express';
import type { InitKbRepo } from '../../application/kb/InitKbRepo.js';
import type { ConnectKbRepo } from '../../application/kb/ConnectKbRepo.js';
import type { DisconnectKb } from '../../application/kb/DisconnectKb.js';
import type { ListKbDocuments } from '../../application/kb/ListKbDocuments.js';
import type { GetKbDocument } from '../../application/kb/GetKbDocument.js';
import type { WriteKbDocument } from '../../application/kb/WriteKbDocument.js';
import type { DeleteKbDocument } from '../../application/kb/DeleteKbDocument.js';
import type { BulkCreateCredential } from '../../application/kb/BulkCreateCredential.js';
import { parseBulkText, slugify } from '../../application/kb/BulkCreateCredential.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { bulkCredentialSchema, connectKbSchema, writeDocSchema } from './schemas.js';

type Deps = {
  readonly initKbRepo: InitKbRepo;
  readonly connectKbRepo: ConnectKbRepo;
  readonly disconnectKb: DisconnectKb;
  readonly listKbDocuments: ListKbDocuments;
  readonly getKbDocument: GetKbDocument;
  readonly writeKbDocument: WriteKbDocument;
  readonly deleteKbDocument: DeleteKbDocument;
  readonly bulkCreateCredential: BulkCreateCredential;
};

function summaryToDto(s: KbDocumentSummary) {
  return { path: s.path, frontmatter: s.frontmatter, sha: s.sha, validationErrors: s.validationErrors };
}
function docToDto(d: KbDocument) {
  return {
    path: d.path,
    frontmatter: d.frontmatter,
    body: d.body,
    sha: d.sha,
    validationErrors: d.validationErrors,
  };
}

export function kbRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.post('/init', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const result = await deps.initKbRepo.execute(projectId, req.user!.id);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  });

  router.post('/connect', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const body = connectKbSchema.parse(req.body);
      await deps.connectKbRepo.execute(projectId, req.user!.id, body.fullName);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      await deps.disconnectKb.execute(projectId, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/tree', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const list = await deps.listKbDocuments.execute(projectId, req.user!.id);
      res.json({ documents: list.map(summaryToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/documents/*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const path = (req.params as Record<string, string>)['0'] ?? '';
      const doc = await deps.getKbDocument.execute(projectId, req.user!.id, path);
      res.json({ document: docToDto(doc) });
    } catch (e) {
      next(e);
    }
  });

  router.put('/documents/*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const rawPath = (req.params as Record<string, string>)['0'] ?? '';
      const body = writeDocSchema.parse({ ...req.body, path: rawPath });
      const result = await deps.writeKbDocument.execute({
        projectId,
        userId: req.user!.id,
        path: body.path,
        frontmatter: body.frontmatter as Frontmatter,
        body: body.body,
        sha: body.sha,
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.delete('/documents/*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const path = (req.params as Record<string, string>)['0'] ?? '';
      await deps.deleteKbDocument.execute(projectId, req.user!.id, path);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Bulk-create credential: paste-style "KEY: VALUE" текст → парсинг → vault для секретов
  // + markdown в credentials/<slug>.md.
  router.post('/credentials/bulk', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const body = bulkCredentialSchema.parse(req.body);
      const result = await deps.bulkCreateCredential.execute({
        projectId,
        userId: req.user!.id,
        rawText: body.rawText,
        fileSlugOverride: body.fileSlugOverride ?? null,
        secretOverrides: body.secretOverrides ?? null,
      });
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  });

  // Preview-only endpoint: показать что мы распарсили, БЕЗ записи. Полезно для UI/CLI.
  router.post('/credentials/parse', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = bulkCredentialSchema.parse(req.body);
      const parsed = parseBulkText(body.rawText);
      res.json({
        title: parsed.title,
        kind: parsed.kind,
        fields: parsed.fields,
        suggestedFileSlug: slugify(parsed.title),
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
