import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import { requireAgentCapabilityScope } from '../middleware/requireAgentCapabilityScope.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { PublishSiteArtifact } from '../../application/site/PublishSiteArtifact.js';
import type { SiteFile } from '../../application/site/SiteArtifactStorage.js';
import { siteUrl } from '../../domain/site/SiteArtifact.js';

export type SiteAgentRouterDeps = {
  readonly publishSiteArtifact: PublishSiteArtifact;
  readonly authenticate: AuthenticateAgentToken;
  // Базовый домен для сборки URL результата (<slug>.<baseDomain>).
  readonly baseDomain: string;
  // Лимит суммарного размера сайта в байтах.
  readonly maxSiteBytes: number;
};

// Приём собранного статического сайта от диспетчера (Bearer agent-token). Диспетчер шлёт файлы
// multipart-полем `files`; относительный путь каждого файла — в его filename (originalname).
// Маунтится под /api/agent (рядом с liveAgentRouter). Авторизация «диспетчер проекта» — внутри
// PublishSiteArtifact (requireDispatcherAccess).
export function siteAgentRouter(deps: SiteAgentRouterDeps): Router {
  const router = Router();
  router.use(requireAgentToken(deps.authenticate));
  router.use(requireAgentCapabilityScope());

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxSiteBytes, files: 2000 },
    // Without this busboy reduces every filename to its basename, so "assets/app.js"
    // arrived as "app.js" and any bundler build (Vite, CRA) published flattened and
    // broken — the nested asset 404s. The relative path IS the contract here (see the
    // originalname comment below), so the whole directory tree must survive upload.
    preservePath: true,
  });

  router.post(
    '/projects/:projectId/site-artifact',
    upload.array('files'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
        const files: SiteFile[] = uploaded.map((f) => ({
          // originalname несёт относительный путь (напр. "assets/app.js"); traversal режется в storage.
          path: f.originalname,
          data: f.buffer,
        }));
        if (files.length === 0) {
          res.status(400).json({ error: 'no_files' });
          return;
        }
        const { slug, publishedAt } = await deps.publishSiteArtifact.execute(
          projectId,
          req.user!.id,
          files,
        );
        res.status(200).json({
          slug,
          url: siteUrl(deps.baseDomain, slug),
          publishedAt: publishedAt.toISOString(),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
