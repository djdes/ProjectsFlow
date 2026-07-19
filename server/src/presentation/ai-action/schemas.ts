import { z } from 'zod';

const uuid = z.string().uuid();

const actionTypeSchema = z.enum([
  'create_project',
  'create_task',
  'update_task',
  'delete_task',
  'delete_all_tasks',
]);

const beforeSnapshotSchema = z
  .object({
    description: z.string().max(20_000).nullable().optional(),
    status: z
      .enum(['backlog', 'todo', 'in_progress', 'awaiting_clarification', 'done', 'manual'])
      .optional(),
    deadline: z.string().max(40).nullable().optional(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  })
  .strict();

const itemSchema = z.object({
  actionId: z.string().min(1).max(80),
  type: actionTypeSchema,
  entityKind: z.enum(['project', 'task']),
  entityId: uuid.nullable().default(null),
  projectId: uuid.nullable().default(null),
  title: z.string().max(300).default(''),
});

export const createBatchSchema = z.object({
  conversationId: uuid,
  messageId: uuid.nullable().default(null),
  idempotencyKey: z.string().min(1).max(100).optional(),
  title: z.string().max(200).default('Действия ассистента'),
  projectId: uuid.nullable().default(null),
  plan: z.record(z.unknown()).nullable().default(null),
  items: z.array(itemSchema).min(1).max(200),
});

const resultSchema = z.object({
  actionId: z.string().min(1).max(80),
  entityId: uuid.nullable().default(null),
  projectId: uuid.nullable().default(null),
  title: z.string().max(300).optional(),
  status: z.enum(['done', 'failed']),
  before: beforeSnapshotSchema.nullable().optional(),
  errorMessage: z.string().max(500).nullable().optional(),
});

export const resultsSchema = z.object({
  results: z.array(resultSchema).max(200).default([]),
});
