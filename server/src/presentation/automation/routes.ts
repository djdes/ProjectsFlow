import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AutomationConfig } from '../../domain/automation/Automation.js';
import type { GetAutomationConfig } from '../../application/automation/GetAutomationConfig.js';
import type { SaveAutomationConfig } from '../../application/automation/SaveAutomationConfig.js';
import { AUTOMATION_CRITERIA_BY_KEY } from '../../application/automation/criteria.js';
import { requireAuth } from '../middleware/requireAuth.js';

const criterionSchema = z.object({
  key: z.string().trim().min(1).max(40),
  enabled: z.boolean(),
  systemPrompt: z.string().max(8000),
  userHint: z
    .string()
    .max(2000)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : null)),
});

const saveBodySchema = z
  .object({
    enabled: z.boolean(),
    limitKind: z.enum(['count', 'time']),
    limitCount: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    limitMinutes: z
      .number()
      .int()
      .min(1)
      .max(100_000)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    pauseMinSeconds: z.number().int().min(0).max(86_400),
    pauseMaxSeconds: z.number().int().min(0).max(86_400),
    // Автоматизация ВСЕГДА в тихом режиме — режим заперт на 'silent' (диспетчер тоже форсит).
    ralphMode: z.literal('silent').optional().default('silent'),
    criteria: z.array(criterionSchema).max(20),
  })
  .refine((b) => b.pauseMaxSeconds >= b.pauseMinSeconds, {
    message: 'pauseMaxSeconds must be >= pauseMinSeconds',
    path: ['pauseMaxSeconds'],
  });

type Deps = {
  readonly getAutomationConfig: GetAutomationConfig;
  readonly saveAutomationConfig: SaveAutomationConfig;
};

export function buildAutomationRouter(deps: Deps): Router {
  const r = Router();

  // GET /api/projects/:projectId/automation — конфиг для диалога настроек.
  r.get(
    '/projects/:projectId/automation',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const config = await deps.getAutomationConfig.execute({
          projectId,
          userId: req.user!.id,
        });
        res.json(automationConfigToDto(config));
      } catch (e) {
        next(e);
      }
    },
  );

  // PUT /api/projects/:projectId/automation — сохранить конфиг (editor+).
  r.put(
    '/projects/:projectId/automation',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = saveBodySchema.parse(req.body);
        const config = await deps.saveAutomationConfig.execute({
          projectId,
          userId: req.user!.id,
          enabled: body.enabled,
          limitKind: body.limitKind,
          limitCount: body.limitCount,
          limitMinutes: body.limitMinutes,
          pauseMinSeconds: body.pauseMinSeconds,
          pauseMaxSeconds: body.pauseMaxSeconds,
          ralphMode: body.ralphMode,
          criteria: body.criteria,
        });
        res.json(automationConfigToDto(config));
      } catch (e) {
        next(e);
      }
    },
  );

  return r;
}

function automationConfigToDto(config: AutomationConfig): {
  enabled: boolean;
  limitKind: AutomationConfig['limitKind'];
  limitCount: number | null;
  limitMinutes: number | null;
  pauseMinSeconds: number;
  pauseMaxSeconds: number;
  ralphMode: string;
  runStatus: AutomationConfig['runStatus'];
  runStartedAt: string | null;
  tasksCreated: number;
  lastTaskAt: string | null;
  criteria: ReadonlyArray<{
    key: string;
    label: string;
    enabled: boolean;
    systemPrompt: string;
    userHint: string | null;
  }>;
} {
  return {
    enabled: config.enabled,
    limitKind: config.limitKind,
    limitCount: config.limitCount,
    limitMinutes: config.limitMinutes,
    pauseMinSeconds: config.pauseMinSeconds,
    pauseMaxSeconds: config.pauseMaxSeconds,
    ralphMode: config.ralphMode,
    runStatus: config.runStatus,
    runStartedAt: config.runStartedAt ? config.runStartedAt.toISOString() : null,
    tasksCreated: config.tasksCreated,
    lastTaskAt: config.lastTaskAt ? config.lastTaskAt.toISOString() : null,
    criteria: config.criteria.map((c) => ({
      key: c.key,
      label: AUTOMATION_CRITERIA_BY_KEY.get(c.key)?.label ?? c.key,
      enabled: c.enabled,
      systemPrompt: c.systemPrompt,
      userHint: c.userHint,
    })),
  };
}
