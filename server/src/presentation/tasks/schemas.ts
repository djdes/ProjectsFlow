import { z } from 'zod';

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);

export const createTaskSchema = z.object({
  description: z.string().trim().min(1, 'Введите описание').max(5000),
  status: taskStatusSchema.optional(),
});

export const updateTaskSchema = z
  .object({
    description: z.string().trim().min(1).max(5000).optional(),
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

export const updateTaskCommentSchema = z.object({
  body: z.string().trim().min(1, 'Введите текст комментария').max(10000),
});

export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type MoveTaskBody = z.infer<typeof moveTaskSchema>;
export type LinkCommitBody = z.infer<typeof linkCommitSchema>;
export type CreateTaskCommentBody = z.infer<typeof createTaskCommentSchema>;
export type UpdateTaskCommentBody = z.infer<typeof updateTaskCommentSchema>;
