import { z } from 'zod';

const uuid = z.string().uuid();

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
  mode: z.enum(['chat', 'studio_plan']).optional(),
  expectedConversationVersion: z.coerce.number().int().positive().optional(),
}).strict();

export const streamQuerySchema = z.object({
  afterEventSeq: z.coerce.number().int().nonnegative().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
}).transform((value) => ({ afterEventSeq: value.afterEventSeq ?? value.after }));
