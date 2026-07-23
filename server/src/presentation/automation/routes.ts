import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AutomationConfig } from '../../domain/automation/Automation.js';
import type { GetAutomationConfig } from '../../application/automation/GetAutomationConfig.js';
import type { SaveAutomationConfig } from '../../application/automation/SaveAutomationConfig.js';
import type { RunCommitSyncNow } from '../../application/commit-sync/RunCommitSyncNow.js';
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
    // Публикация/деплой (db/061). Опциональны с дефолтами — старый клиент не падает.
    gitAuthorMode: z.enum(['bot', 'owner', 'custom']).optional().default('bot'),
    gitAuthorName: z
      .string()
      .trim()
      .max(120)
      // Без кавычек/переводов строк: значение подставляется в `git config user.name "..."`
      // и в промпт воркера — иначе вектор инъекции (email уже ограничен .email()).
      .regex(/^[^\r\n"]*$/, 'Имя автора не должно содержать кавычки и переводы строк')
      .nullable()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v : null)),
    gitAuthorEmail: z
      .string()
      .trim()
      .email()
      .max(254)
      .nullable()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v : null)),
    ignoreClaudeMd: z.boolean().optional().default(false),
    ultracodeReviewEnabled: z.boolean().optional().default(false),
    deployMethod: z.enum(['github_auto', 'ssh_manual', 'none', 'auto']).optional().default('github_auto'),
    deployCommand: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v : null)),
    // Ежедневная авто-обработка статусов задач по коммитам (db/072). Опциональны с
    // дефолтами — старый клиент не падает. Редактируемы editor+ (не publish-settings).
    commitSyncEnabled: z.boolean().optional().default(false),
    commitSyncHour: z.number().int().min(0).max(23).optional().default(3),
    commitSyncMinute: z.number().int().min(0).max(59).optional().default(0),
    // Дни недели сверки (0..6). Опционально: старый клиент не шлёт — режим остаётся как в БД.
    commitSyncDaysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    commitSyncThresholdHours: z.number().int().min(1).max(8760).optional().default(70),
    // Что делать с совпадением: 'auto' — сервер сразу переносит задачу в готово; 'propose' —
    // предлагает закрыть кнопкой (участник подтверждает). Опционально: старый клиент не шлёт
    // поле, и режим остаётся тем, что в БД.
    commitSyncAction: z.enum(['propose', 'auto']).optional(),
    assigneeDigestEnabled: z.boolean().optional(),
    criteria: z.array(criterionSchema).max(20),
  })
  .refine((b) => b.pauseMaxSeconds >= b.pauseMinSeconds, {
    message: 'pauseMaxSeconds must be >= pauseMinSeconds',
    path: ['pauseMaxSeconds'],
  })
  // custom-автор требует и имя, и email.
  .refine((b) => b.gitAuthorMode !== 'custom' || (!!b.gitAuthorName && !!b.gitAuthorEmail), {
    message: 'gitAuthorName and gitAuthorEmail are required when gitAuthorMode is custom',
    path: ['gitAuthorName'],
  })
  // ssh_manual требует команду деплоя.
  .refine((b) => b.deployMethod !== 'ssh_manual' || !!b.deployCommand, {
    message: 'deployCommand is required when deployMethod is ssh_manual',
    path: ['deployCommand'],
  });

type Deps = {
  readonly getAutomationConfig: GetAutomationConfig;
  readonly saveAutomationConfig: SaveAutomationConfig;
  readonly runCommitSyncNow: RunCommitSyncNow;
};

export function buildAutomationRouter(deps: Deps): Router {
  const r = Router();

  // POST /api/projects/:projectId/commit-sync/run — ручная сверка «Сверить сейчас» (editor+).
  // Ставит job немедленно (мимо ежедневного расписания); раннер подхватит в течение минуты.
  r.post(
    '/projects/:projectId/commit-sync/run',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const result = await deps.runCommitSyncNow.execute(projectId, req.user!.id);
        if (result.ok) {
          res.status(202).json({ status: 'queued', jobId: result.jobId });
          return;
        }
        // already_running — 409 (не ошибка клиента, состояние), unavailable — 422.
        res
          .status(result.reason === 'already_running' ? 409 : 422)
          .json({ status: result.reason });
      } catch (e) {
        next(e);
      }
    },
  );

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
          gitAuthorMode: body.gitAuthorMode,
          gitAuthorName: body.gitAuthorName,
          gitAuthorEmail: body.gitAuthorEmail,
          ignoreClaudeMd: body.ignoreClaudeMd,
          ultracodeReviewEnabled: body.ultracodeReviewEnabled,
          deployMethod: body.deployMethod,
          deployCommand: body.deployCommand,
          commitSyncEnabled: body.commitSyncEnabled,
          commitSyncHour: body.commitSyncHour,
          commitSyncMinute: body.commitSyncMinute,
          commitSyncDaysOfWeek: body.commitSyncDaysOfWeek,
          commitSyncThresholdHours: body.commitSyncThresholdHours,
          commitSyncAction: body.commitSyncAction,
          assigneeDigestEnabled: body.assigneeDigestEnabled,
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
  gitAuthorMode: AutomationConfig['gitAuthorMode'];
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  ignoreClaudeMd: boolean;
  ultracodeReviewEnabled: boolean;
  deployMethod: AutomationConfig['deployMethod'];
  deployCommand: string | null;
  runStatus: AutomationConfig['runStatus'];
  runStartedAt: string | null;
  tasksCreated: number;
  lastTaskAt: string | null;
  commitSyncEnabled: boolean;
  commitSyncHour: number;
  commitSyncMinute: number;
  commitSyncDaysOfWeek: readonly number[];
  commitSyncThresholdHours: number;
  commitSyncAction: 'propose' | 'auto';
  commitSyncLastRunOn: string | null;
  assigneeDigestEnabled: boolean;
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
    gitAuthorMode: config.gitAuthorMode,
    gitAuthorName: config.gitAuthorName,
    gitAuthorEmail: config.gitAuthorEmail,
    ignoreClaudeMd: config.ignoreClaudeMd,
    ultracodeReviewEnabled: config.ultracodeReviewEnabled,
    deployMethod: config.deployMethod,
    deployCommand: config.deployCommand,
    runStatus: config.runStatus,
    runStartedAt: config.runStartedAt ? config.runStartedAt.toISOString() : null,
    tasksCreated: config.tasksCreated,
    lastTaskAt: config.lastTaskAt ? config.lastTaskAt.toISOString() : null,
    commitSyncEnabled: config.commitSyncEnabled,
    commitSyncHour: config.commitSyncHour,
    commitSyncMinute: config.commitSyncMinute,
    commitSyncDaysOfWeek: config.commitSyncDaysOfWeek,
    commitSyncThresholdHours: config.commitSyncThresholdHours,
    commitSyncAction: config.commitSyncAction,
    commitSyncLastRunOn: config.commitSyncLastRunOn,
    assigneeDigestEnabled: config.assigneeDigestEnabled,
    criteria: config.criteria.map((c) => ({
      key: c.key,
      label: AUTOMATION_CRITERIA_BY_KEY.get(c.key)?.label ?? c.key,
      enabled: c.enabled,
      systemPrompt: c.systemPrompt,
      userHint: c.userHint,
    })),
  };
}
