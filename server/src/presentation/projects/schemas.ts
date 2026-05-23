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

// Персональная пересортировка: полный список id проектов в желаемом порядке.
export const reorderProjectsSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

// Пер-участниковые настройки оповещений: карта тип→{team,mcp}. Ключи валидируем как
// известные типы; неизвестные отсекаем (passthrough off).
const NOTIF_EVENT_TYPES = [
  'task_created',
  'task_done',
  'comment_created',
  'member_changed',
  'commit_linked',
  'kb_updated',
] as const;

export const notificationPrefsSchema = z.record(
  z.enum(NOTIF_EVENT_TYPES),
  z.object({ team: z.boolean(), mcp: z.boolean() }),
);

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;
export type ReorderProjectsBody = z.infer<typeof reorderProjectsSchema>;

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

// Назначить или снять Ralph-диспетчера проекта. userId: null = снять.
export const setDispatcherSchema = z.object({
  userId: z.string().min(1).nullable(),
});

// Включить/выключить per-member делегацию GitHub-токена. Default granter =
// callerUserId (caller включает СВОЮ делегацию). Optional `granterUserId` —
// для admin-on-behalf: admin указывает за кого toggle'ить.
export const setGitTokenDelegationSchema = z.object({
  enabled: z.boolean(),
  granterUserId: z.string().min(1).optional(),
});

export type CreateInviteBody = z.infer<typeof createInviteSchema>;
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleSchema>;
export type TransferOwnershipBody = z.infer<typeof transferOwnershipSchema>;
export type SetDispatcherBody = z.infer<typeof setDispatcherSchema>;
export type SetGitTokenDelegationBody = z.infer<typeof setGitTokenDelegationSchema>;
