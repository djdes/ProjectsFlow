import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(80),
});

// Мягкая валидация URL: пытаемся распарсить как URL.
// Поддерживаем http(s) и git+ssh-форму (parse() это принимает с протоколом).
const urlOrNullSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (s) => {
      if (s.length === 0) return false;
      try {
        new URL(s);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Введите корректный URL' },
  )
  .nullable();

// "owner/repo" — формат GitHub full name.
const kbRepoFullNameOrNullSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, { message: 'Format: owner/repo' })
  .nullable();

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    gitRepoUrl: urlOrNullSchema.optional(),
    kbRepoFullName: kbRepoFullNameOrNullSchema.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: 'Нечего обновлять' });

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;

export const createInviteSchema = z.object({
  role: z.enum(['editor', 'viewer']),
  // Опциональный email — пометка «для кого». Пусто/null → не сохраняем.
  email: z
    .string()
    .trim()
    .email('Невалидный email')
    .max(255)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['editor', 'viewer']),
});

export const transferOwnershipSchema = z.object({
  toUserId: z.string().min(1),
});

export type CreateInviteBody = z.infer<typeof createInviteSchema>;
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleSchema>;
export type TransferOwnershipBody = z.infer<typeof transferOwnershipSchema>;
