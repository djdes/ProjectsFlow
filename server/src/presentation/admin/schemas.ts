import { z } from 'zod';

export const adminUserPatchSchema = z.object({
  displayName: z.string().trim().min(1, 'Введите имя').max(80, 'Имя длиннее 80 символов').optional(),
  email: z.string().trim().toLowerCase().max(255).email('Введите корректную почту').optional(),
  isAdmin: z.boolean().optional(),
  avatarUrl: z.null().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, 'Нет данных для изменения');

export const adminPlanSchema = z.object({
  plan: z.enum(['free', 'prime', 'vip']),
  subscriptionExpiresAt: z.string().datetime({ offset: true, message: 'Укажите корректную дату окончания' }).nullable().optional(),
}).strict();
