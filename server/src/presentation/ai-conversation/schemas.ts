import { z } from 'zod';
import { AI_AGENT_STEP_KINDS } from '../../domain/ai-conversation/AiAgentStep.js';

const uuid = z.string().uuid();

/**
 * Шаг работы агента в том виде, в каком его присылает воркер. Схема общая для чата и
 * для job'ов визуального редактора: у обоих один и тот же воркер, и разъехавшийся
 * контракт шага означал бы, что «N шагов» рисуется только в одном из двух мест.
 * Ярлык не принимается — его пишет сервер из kind (см. normalizeAgentSteps).
 */
export const agentStepSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  kind: z.enum(AI_AGENT_STEP_KINDS as unknown as [string, ...string[]]),
  detail: z.string().max(2_000).nullable().optional(),
  startedAt: z.string().max(40).nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
}).strict();

export const createConversationSchema = z.object({
  kind: z.enum(['personal', 'project_studio']),
  projectId: uuid.nullish(),
  title: z.string().trim().min(1).max(120).nullish(),
}).strict();

export const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  expectedVersion: z.coerce.number().int().positive().optional(),
}).strict();

export const versionSchema = z.object({
  expectedVersion: z.coerce.number().int().positive().optional(),
}).strict();

export const listConversationsQuerySchema = z.object({
  kind: z.enum(['personal', 'project_studio']).optional(),
  scope: z.enum(['personal', 'project', 'all']).optional(),
  projectId: uuid.optional(),
  search: z.string().trim().max(120).optional(),
  archived: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  before: z.string().datetime().transform((value) => new Date(value)).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const listMessagesQuerySchema = z.object({
  beforeSeq: z.coerce.number().int().nonnegative().optional(),
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).refine((value) => value.beforeSeq === undefined || value.afterSeq === undefined, {
  message: 'beforeSeq and afterSeq are mutually exclusive',
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(50_000),
  clientRequestId: uuid,
  // studio_edit — пометка «сообщение про правку зоны сайта». Ссылку на зону и связь с
  // job'ом клиент задать не может: их проставляет только серверный путь редактора.
  mode: z.enum(['chat', 'studio_plan', 'studio_edit']).optional(),
  expectedConversationVersion: z.coerce.number().int().positive().optional(),
}).strict();

export const streamQuerySchema = z.object({
  afterEventSeq: z.coerce.number().int().nonnegative().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
}).transform((value) => ({ afterEventSeq: value.afterEventSeq ?? value.after }));
