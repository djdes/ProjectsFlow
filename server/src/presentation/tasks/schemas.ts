import { z } from 'zod';

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Введите название').max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  status: taskStatusSchema.optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
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

export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type MoveTaskBody = z.infer<typeof moveTaskSchema>;
export type LinkCommitBody = z.infer<typeof linkCommitSchema>;
