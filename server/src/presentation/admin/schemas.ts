import { z } from 'zod';
import {
  ADMIN_USER_FILTERS, ADMIN_USER_PAGE_SIZE_MAX, ADMIN_USER_SORTS, DEFAULT_ADMIN_USER_QUERY,
} from '../../domain/user/adminUserDirectory.js';
import { BULK_PLAN_MAX_USERS } from '../../application/admin/BulkSetPlanAsAdmin.js';

export const adminUserPatchSchema = z.object({
  displayName: z.string().trim().min(1, 'Введите имя').max(80, 'Имя длиннее 80 символов').optional(),
  email: z.string().trim().toLowerCase().max(255).email('Введите корректную почту').optional(),
  isAdmin: z.boolean().optional(),
  avatarUrl: z.null().optional(),
  telegram: z.null().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, 'Нет данных для изменения');

export const adminPlanSchema = z.object({
  plan: z.enum(['free', 'prime', 'vip']),
  subscriptionExpiresAt: z.string().datetime({ offset: true, message: 'Укажите корректную дату окончания' }).nullable().optional(),
}).strict();

const intParam = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).catch(fallback);

// GET /admin/users: unknown or malformed values fall back to defaults instead of failing,
// so an old bookmarked URL still opens the console.
export const adminUserQuerySchema = z.object({
  q: z.string().max(200).catch('').default(''),
  filter: z.enum(ADMIN_USER_FILTERS).catch(DEFAULT_ADMIN_USER_QUERY.filter).default(DEFAULT_ADMIN_USER_QUERY.filter),
  inactiveDays: intParam(1, 3650, DEFAULT_ADMIN_USER_QUERY.inactiveDays).default(DEFAULT_ADMIN_USER_QUERY.inactiveDays),
  sort: z.enum(ADMIN_USER_SORTS).catch(DEFAULT_ADMIN_USER_QUERY.sort).default(DEFAULT_ADMIN_USER_QUERY.sort),
  dir: z.enum(['asc', 'desc']).catch(DEFAULT_ADMIN_USER_QUERY.dir).default(DEFAULT_ADMIN_USER_QUERY.dir),
  page: intParam(1, 100_000, 1).default(1),
  pageSize: intParam(1, ADMIN_USER_PAGE_SIZE_MAX, DEFAULT_ADMIN_USER_QUERY.pageSize).default(DEFAULT_ADMIN_USER_QUERY.pageSize),
});

export const adminBulkPlanSchema = z.object({
  userIds: z.array(z.string().min(1).max(64)).min(1, 'Выберите пользователей').max(BULK_PLAN_MAX_USERS),
  plan: z.enum(['prime', 'vip']),
  term: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('extend'), days: z.number().int().min(1).max(3650) }),
    z.object({ kind: z.literal('until'), date: z.string().datetime({ offset: true, message: 'Укажите корректную дату окончания' }) }),
    z.object({ kind: z.literal('unlimited') }),
  ]),
}).strict();
