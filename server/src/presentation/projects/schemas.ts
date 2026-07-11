import { z } from 'zod';
import { KANBAN_COLORS, VISIBLE_KANBAN_STATUSES } from '../../domain/kanban/KanbanSettings.js';
import { NOTIF_EVENT_TYPES, type NotifEventType } from '../../domain/notifications/NotificationPrefs.js';
import { ASSIGNED_GROUPINGS } from '../../domain/user/UiPrefs.js';

const NOTIF_EVENT_TYPES_TUPLE = NOTIF_EVENT_TYPES as unknown as [NotifEventType, ...NotifEventType[]];

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(80),
});

// PATCH /:id/publish — тоггл индексации публичной доски поисковиками.
export const setPublicIndexingSchema = z.object({
  indexing: z.boolean(),
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
    // Эмодзи-иконка проекта; null = сбросить на дефолтную папку.
    icon: z.string().trim().min(1).max(16).nullable().optional(),
    gitRepoUrl: urlOrNullSchema.optional(),
    kbRepoFullName: kbRepoFullNameOrNullSchema.optional(),
    // Статус проекта: 'archived' прячет его в секцию «Архивные», 'active' возвращает.
    status: z.enum(['active', 'paused', 'archived']).optional(),
    // Notion-style шапка (db/091): описание (свободный текст, лимит 2000 симв.),
    // обложка (`gradient:<id>` или URL) и её вертикальная позиция (%).
    description: z.string().max(2000).nullable().optional(),
    coverUrl: z.string().trim().max(500).nullable().optional(),
    coverPosition: z.number().int().min(0).max(100).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: 'Нечего обновлять' });

// Персональная пересортировка: полный список id проектов в желаемом порядке.
export const reorderProjectsSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

// Toggle favorite-флага для проекта в сайдбаре текущего юзера.
export const toggleFavoriteSchema = z.object({
  favorite: z.boolean(),
});

// Пересортировка проектов в секции «Избранное» сайдбара. Симметрично reorderProjectsSchema.
export const reorderFavoritesSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

// Пер-участниковые настройки оповещений: карта тип→{team,mcp}. Источник типов —
// domain NOTIF_EVENT_TYPES (включая 'server_alert'); неизвестные ключи отсекаем.
export const notificationPrefsSchema = z.record(
  z.enum(NOTIF_EVENT_TYPES_TUPLE),
  z.object({ team: z.boolean(), mcp: z.boolean() }),
);

// Кастомизация одной канбан-колонки: цвет / переименованный заголовок / флаг скрытия.
// Все поля опциональны — отсутствие = «дефолт». label триммим и ограничиваем длину.
const kanbanColumnSettingsSchema = z.object({
  color: z.enum(KANBAN_COLORS).optional(),
  label: z.string().trim().max(40).optional(),
  hidden: z.boolean().optional(),
});

// Общие настройки доски: карта status→{color,label,hidden}. Ключи — только видимые колонки.
export const kanbanSettingsSchema = z.record(
  z.enum(VISIBLE_KANBAN_STATUSES),
  kanbanColumnSettingsSchema,
);

// Глобальная карта дефолтных цветов колонок (профиль юзера): status→color.
export const kanbanDefaultColorsSchema = z.record(
  z.enum(VISIBLE_KANBAN_STATUSES),
  z.enum(KANBAN_COLORS),
);

// Пользовательские вью доски (Notion-style, db/103).
export const createBoardViewSchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(64),
  type: z.enum(['kanban', 'table', 'list', 'calendar']),
});
export const updateBoardViewSchema = z
  .object({
    name: z.string().trim().min(1, 'Введите название').max(64).optional(),
    type: z.enum(['kanban', 'table', 'list', 'calendar']).optional(),
  })
  .refine((v) => v.name !== undefined || v.type !== undefined, {
    message: 'Нечего обновлять',
  });

// Персональные UI-настройки клиента (профиль). Все поля optional — частичный мерж.
export const uiPrefsSchema = z.object({
  inboxAssignedGrouping: z.enum(ASSIGNED_GROUPINGS).optional(),
  // Порядок строк-свойств окна задачи; ограничиваем длину/строки (без жёсткого enum,
  // чтобы добавление новых ключей-свойств не требовало правки схемы).
  taskPropertyOrder: z.array(z.string().max(32)).max(20).optional(),
  // Ширина левой панели (px). Диапазон с запасом; клиент клампит жёстче.
  sidebarWidth: z.number().int().min(180).max(800).optional(),
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;
export type ReorderProjectsBody = z.infer<typeof reorderProjectsSchema>;
export type ToggleFavoriteBody = z.infer<typeof toggleFavoriteSchema>;
export type ReorderFavoritesBody = z.infer<typeof reorderFavoritesSchema>;

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

// Включить/выключить «Мультизадачный воркер» проекта (параллельное выполнение задач).
export const setMultiTaskWorkerSchema = z.object({
  enabled: z.boolean(),
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
export type SetMultiTaskWorkerBody = z.infer<typeof setMultiTaskWorkerSchema>;
export type SetGitTokenDelegationBody = z.infer<typeof setGitTokenDelegationSchema>;
