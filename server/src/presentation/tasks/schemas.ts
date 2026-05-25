import { z } from 'zod';

export const taskStatusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
]);

// Режим работы Ralph. См. spec C:/www/ralph/prompts/task-ralph-mode.md.
export const ralphModeSchema = z.enum(['normal', 'silent', 'grillme']);

export const createTaskSchema = z.object({
  description: z.string().trim().min(1, 'Введите описание').max(5000),
  status: taskStatusSchema.optional(),
  ralphMode: ralphModeSchema.optional(),
});

export const updateTaskSchema = z
  .object({
    description: z.string().trim().min(1).max(5000).optional(),
    ralphMode: ralphModeSchema.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Нечего обновлять' });

export const moveTaskSchema = z.object({
  targetStatus: taskStatusSchema,
  beforeTaskId: z.string().nullable(),
  afterTaskId: z.string().nullable(),
});

// Полный SHA — 40 hex. Принимаем и короткий (минимум 7) — GitHub API сам резолвит.
export const linkCommitSchema = z.object({
  sha: z.string().trim().regex(/^[0-9a-f]{7,40}$/i, { message: 'Невалидный SHA коммита' }),
});

// Лимит 10000 символов — на пару порядков больше типичного комментария, но защищает
// от случайной вставки гигантского лога.
export const createTaskCommentSchema = z.object({
  body: z.string().trim().min(1, 'Введите текст комментария').max(10000),
});

// Agent-вариант: тот же body + optional agentName. Поле опциональное чтобы старые
// MCP-клиенты без agentName продолжали работать — сервер дефолтит 'ralph-dispatcher'.
// Длина 64 — соответствует VARCHAR(64) в схеме. Список значений не enum (forward-compat
// под новых агентов без миграции/деплоя сервера).
export const createAgentTaskCommentSchema = z.object({
  body: z.string().trim().min(1, 'Введите текст комментария').max(10000),
  agentName: z.string().trim().min(1).max(64).optional(),
});

export const updateTaskCommentSchema = z.object({
  body: z.string().trim().min(1, 'Введите текст комментария').max(10000),
});

export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type MoveTaskBody = z.infer<typeof moveTaskSchema>;
export type LinkCommitBody = z.infer<typeof linkCommitSchema>;
export type CreateTaskCommentBody = z.infer<typeof createTaskCommentSchema>;
export type CreateAgentTaskCommentBody = z.infer<typeof createAgentTaskCommentSchema>;
export type UpdateTaskCommentBody = z.infer<typeof updateTaskCommentSchema>;
