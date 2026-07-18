import { createHash } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import type { SiteEditorService } from '../../application/site-editor/SiteEditorService.js';
import type { ProjectEditJob, SitePatch } from '../../domain/site-editor/SiteEditor.js';
import {
  ProjectEditDispatcherMissingError,
  ProjectEditJobNotFoundError,
  ProjectEditJobStateError,
  SiteEditorArtifactConflictError,
  SiteEditorNotDeployedError,
  SiteEditorPatchNotFoundError,
  SiteEditorRevisionConflictError,
  SiteEditorSessionInvalidError,
  SiteEditorValidationError,
} from '../../domain/site-editor/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  createJobSchema,
  createPatchSchema,
  deletePatchSchema,
  updatePatchSchema,
} from './schemas.js';
import { SITE_EDITOR_BRIDGE_SCRIPT } from './bridgeScript.js';

type Deps = { readonly service: SiteEditorService };

const frontendLocatorSchema = z.object({
  selector: z.string().min(1).max(1000),
  tagName: z.string().min(1).max(64),
  text: z.string().max(512).optional(),
  attributes: z.record(z.string().max(64), z.string().max(200)).optional(),
}).strict();
const frontendSnapshotSchema = z.object({
  locator: frontendLocatorSchema,
  source: z.string().max(50_000).optional(),
  styles: z.record(z.string().max(64), z.string().max(500)).optional(),
}).strict();
const frontendPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string().max(4_000) }).strict(),
  z.object({ kind: z.literal('style'), property: z.string().min(1).max(64), value: z.string().max(200) }).strict(),
  z.object({ kind: z.literal('attribute'), name: z.string().min(1).max(64), value: z.string().max(2_000).nullable() }).strict(),
  z.object({ kind: z.literal('command'), command: z.enum(['duplicate', 'delete', 'toggle-visibility', 'layout']) }).strict(),
]);
const openFrontendSessionSchema = z.object({
  previewUrl: z.string().url().max(2_000),
  path: z.string().min(1).max(500),
}).strict();
const frontendMutationSchema = z.object({
  revision: z.number().int().min(0).max(2_147_483_647),
  snapshot: frontendSnapshotSchema,
  patch: frontendPatchSchema,
}).strict();
const frontendRevisionSchema = z.object({ revision: z.number().int().min(0).max(2_147_483_647) }).strict();
const frontendJobSchema = z.object({ prompt: z.string().min(1).max(2_000), snapshot: frontendSnapshotSchema }).strict();

function frontendLocator(snapshot: z.infer<typeof frontendSnapshotSchema>) {
  return {
    cssPath: snapshot.locator.selector,
    tagName: snapshot.locator.tagName,
    stableAttributes: snapshot.locator.attributes ?? {},
    ...(snapshot.locator.text ? { textFingerprint: snapshot.locator.text } : {}),
  };
}

function translateFrontendPatch(patch: z.infer<typeof frontendPatchSchema>): {
  kind: 'text' | 'style' | 'attribute' | 'visibility' | 'command'; payload: Readonly<Record<string, unknown>>;
} {
  if (patch.kind === 'text') return { kind: 'text', payload: { text: patch.value } };
  if (patch.kind === 'style') return { kind: 'style', payload: { styles: { [patch.property]: patch.value } } };
  if (patch.kind === 'attribute') return { kind: 'attribute', payload: { name: patch.name, value: patch.value } };
  if (patch.command === 'toggle-visibility') return { kind: 'visibility', payload: { hidden: true } };
  return { kind: 'command', payload: { command: patch.command } };
}

function frontendJobDto(job: ProjectEditJob): unknown {
  return {
    id: job.id,
    status: job.status === 'succeeded' ? 'completed' : job.status,
    ...(job.status === 'running' ? { progress: 50, message: 'ИИ изменяет выбранный элемент…' } : {}),
    ...(job.status === 'succeeded' ? { progress: 100, message: 'Готово' } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function patchDto(patch: SitePatch): unknown {
  return {
    id: patch.id,
    locator: patch.locator,
    kind: patch.kind,
    payload: patch.payload,
    createdRevision: patch.createdRevision,
    createdAt: patch.createdAt.toISOString(),
    updatedAt: patch.updatedAt.toISOString(),
  };
}

function jobDto(job: ProjectEditJob): unknown {
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    operation: job.operation,
    route: job.route,
    locator: job.locator,
    prompt: job.prompt,
    artifactVersion: job.artifactVersion,
    result: job.result,
    error: job.error,
    claimedAt: job.claimedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function siteEditorRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/:projectId/site-editor/sessions', async (req, res, next) => {
    try {
      const body = openFrontendSessionSchema.parse(req.body);
      const session = await deps.service.createSession(req.params.projectId as string, req.user!.id, body.path);
      const patches = await deps.service.getPatches(req.params.projectId as string, req.user!.id, body.path);
      res.status(201).json({ session: {
        id: session.id,
        nonce: session.token,
        revision: patches.revision,
        canEdit: true,
        // Legacy/API aliases are intentionally create-only; no read endpoint ever
        // serializes the stored token hash or the short-lived raw token again.
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        artifactVersion: session.artifactVersion,
      } });
    } catch (error) { handleError(error, res, next); }
  });

  // Session-scoped compatibility contract used by the Preview editor UI. Persistence
  // still goes through the same project-scoped revision/idempotency service below.
  router.post('/:projectId/site-editor/sessions/:sessionId/patches', async (req, res, next) => {
    try {
      const body = frontendMutationSchema.parse(req.body);
      const projectId = req.params.projectId as string;
      const sessionId = req.params.sessionId as string;
      const session = await deps.service.requireSession(projectId, req.user!.id, sessionId);
      const translated = translateFrontendPatch(body.patch);
      const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const snapshot = await deps.service.createPatch({
        projectId,
        userId: req.user!.id,
        route: session.route,
        baseRevision: body.revision,
        idempotencyKey: `${sessionId}:${digest}`.slice(0, 100),
        patch: { locator: frontendLocator(body.snapshot), ...translated },
      });
      res.status(201).json({ revision: snapshot.revision });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/:projectId/site-editor/sessions/:sessionId/undo', async (req, res, next) => {
    try {
      const body = frontendRevisionSchema.parse(req.body);
      const snapshot = await deps.service.undoSessionPatch(
        req.params.projectId as string, req.user!.id, req.params.sessionId as string, body.revision,
      );
      res.json({ revision: snapshot.revision });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/:projectId/site-editor/sessions/:sessionId/redo', async (req, res, next) => {
    try {
      const body = frontendRevisionSchema.parse(req.body);
      const snapshot = await deps.service.redoSessionPatch(
        req.params.projectId as string, req.user!.id, req.params.sessionId as string, body.revision,
      );
      res.json({ revision: snapshot.revision });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/:projectId/site-editor/sessions/:sessionId/jobs', async (req, res, next) => {
    try {
      const body = frontendJobSchema.parse(req.body);
      const projectId = req.params.projectId as string;
      const session = await deps.service.requireSession(projectId, req.user!.id, req.params.sessionId as string);
      const job = await deps.service.createJob({
        projectId,
        userId: req.user!.id,
        route: session.route,
        locator: frontendLocator(body.snapshot),
        domSnapshot: body.snapshot.source ?? '',
        computedStyles: body.snapshot.styles ?? {},
        prompt: body.prompt,
        operation: 'regenerate_element',
        artifactVersion: session.artifactVersion,
      });
      res.status(202).json({ job: frontendJobDto(job) });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/:projectId/site-editor/sessions/:sessionId/jobs/:jobId', async (req, res, next) => {
    try {
      const projectId = req.params.projectId as string;
      const session = await deps.service.requireSession(projectId, req.user!.id, req.params.sessionId as string);
      const job = await deps.service.getJob(projectId, req.user!.id, req.params.jobId as string);
      if (job.route !== session.route || job.createdBy !== req.user!.id) throw new ProjectEditJobNotFoundError();
      res.json({ job: frontendJobDto(job) });
    } catch (error) { handleError(error, res, next); }
  });

  router.delete('/:projectId/site-editor/sessions/:sessionId', async (req, res, next) => {
    try {
      await deps.service.revokeSession(
        req.params.projectId as string,
        req.user!.id,
        req.params.sessionId as string,
      );
      res.status(204).end();
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/:projectId/site-editor/patches', async (req, res, next) => {
    try {
      const route = typeof req.query.route === 'string' ? req.query.route : '/';
      const snapshot = await deps.service.getPatches(req.params.projectId as string, req.user!.id, route);
      res.json({ revision: snapshot.revision, patches: snapshot.patches.map(patchDto) });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/:projectId/site-editor/patches', async (req, res, next) => {
    try {
      const body = createPatchSchema.parse(req.body);
      const snapshot = await deps.service.createPatch({
        projectId: req.params.projectId as string,
        userId: req.user!.id,
        ...body,
      });
      res.status(201).json({ revision: snapshot.revision, patches: snapshot.patches.map(patchDto) });
    } catch (error) { handleError(error, res, next); }
  });

  router.patch('/:projectId/site-editor/patches/:patchId', async (req, res, next) => {
    try {
      const body = updatePatchSchema.parse(req.body);
      const snapshot = await deps.service.updatePatch({
        projectId: req.params.projectId as string,
        userId: req.user!.id,
        patchId: req.params.patchId as string,
        ...body,
      });
      res.json({ revision: snapshot.revision, patches: snapshot.patches.map(patchDto) });
    } catch (error) { handleError(error, res, next); }
  });

  router.delete('/:projectId/site-editor/patches/:patchId', async (req, res, next) => {
    try {
      const body = deletePatchSchema.parse(req.body);
      const snapshot = await deps.service.deletePatch(
        req.params.projectId as string,
        req.user!.id,
        req.params.patchId as string,
        body.baseRevision,
      );
      res.json({ revision: snapshot.revision, patches: snapshot.patches.map(patchDto) });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/:projectId/site-editor/jobs', async (req, res, next) => {
    try {
      const body = createJobSchema.parse(req.body);
      const job = await deps.service.createJob({
        projectId: req.params.projectId as string,
        userId: req.user!.id,
        ...body,
      });
      res.status(202).json({ job: jobDto(job) });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/:projectId/site-editor/jobs/:jobId', async (req, res, next) => {
    try {
      const job = await deps.service.getJob(
        req.params.projectId as string,
        req.user!.id,
        req.params.jobId as string,
      );
      res.json({ job: jobDto(job) });
    } catch (error) { handleError(error, res, next); }
  });

  // Fallback bridge payload: authenticated editor UI may fetch this script and hand it
  // to the preview bootstrap. Result-host HTML injection is intentionally not enabled
  // until the deployment server can validate short-lived session tokens before sending HTML.
  router.get('/:projectId/site-editor/bridge.js', async (req, res, next) => {
    try {
      await deps.service.getPatches(req.params.projectId as string, req.user!.id, '/');
      res.setHeader('Cache-Control', 'no-store');
      res.type('application/javascript').send(SITE_EDITOR_BRIDGE_SCRIPT);
    } catch (error) { handleError(error, res, next); }
  });

  return router;
}

export function handleSiteEditorError(error: unknown, res: Response, next: NextFunction): void {
  handleError(error, res, next);
}

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ZodError || error instanceof SiteEditorValidationError) {
    res.status(422).json({ error: 'site_editor_validation', message: error.message });
  } else if (error instanceof SiteEditorRevisionConflictError) {
    res.status(409).json({ error: 'revision_conflict', currentRevision: error.currentRevision });
  } else if (error instanceof SiteEditorArtifactConflictError) {
    res.status(409).json({ error: 'artifact_conflict', currentArtifactVersion: error.currentArtifactVersion });
  } else if (error instanceof SiteEditorNotDeployedError) {
    res.status(409).json({ error: 'site_not_deployed' });
  } else if (error instanceof SiteEditorPatchNotFoundError || error instanceof ProjectEditJobNotFoundError) {
    res.status(404).json({ error: 'not_found' });
  } else if (error instanceof ProjectEditJobStateError) {
    res.status(409).json({ error: 'job_state_conflict', message: error.message });
  } else if (error instanceof ProjectEditDispatcherMissingError) {
    res.status(409).json({ error: 'dispatcher_not_configured' });
  } else if (error instanceof SiteEditorSessionInvalidError) {
    res.status(401).json({ error: 'site_editor_session_invalid' });
  } else {
    next(error);
  }
}
