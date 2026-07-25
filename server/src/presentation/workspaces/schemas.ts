import { z } from 'zod';
import {
  ALL_SCHEDULE_DAYS,
  WEEKDAY_SCHEDULE_DAYS,
  isWeekdaysOnly,
  normalizeScheduleDays,
} from '../../domain/digest/ScheduleDays.js';

const scheduleDaySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  icon: z.string().max(16).nullable().optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().max(16).nullable().optional(),
});

export const setCurrentSchema = z.object({
  workspaceId: z.string().min(1),
});

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'editor', 'viewer']).optional(),
});

export const changeRoleSchema = z.object({
  role: z.enum(['owner', 'editor', 'viewer']),
});

export const moveProjectSchema = z.object({
  targetWorkspaceId: z.string().min(1),
});

export const saveWorkspaceAssigneeDigestSchema = z
  .object({
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    daysOfWeek: z.array(scheduleDaySchema).min(1).max(7).optional(),
    weekdaysOnly: z.boolean().optional().default(false),
    telegramGroupChatId: z.number().int().nullable(),
    telegramGroupTitle: z.string().trim().max(255).nullable(),
    recipientMode: z.enum(['all', 'selected']),
    recipientUserIds: z.array(z.string().uuid()).max(500),
    projectMode: z.enum(['all', 'selected']).default('all'),
    projectIds: z.array(z.string().uuid()).max(500).default([]),
    commitSyncEnabled: z.boolean().default(false),
    commitSyncHour: z.number().int().min(0).max(23).default(17),
    commitSyncMinute: z.number().int().min(0).max(59).default(0),
    commitSyncAction: z.enum(['propose', 'auto']).default('propose'),
    eodReminderEnabled: z.boolean().default(false),
    eodReminderHour: z.number().int().min(0).max(23).default(17),
    eodReminderMinute: z.number().int().min(0).max(59).default(20),
  })
  .refine((value) => !value.enabled || value.telegramGroupChatId !== null, {
    message: 'Выберите Telegram-группу для рассылки',
    path: ['telegramGroupChatId'],
  })
  .refine(
    (value) =>
      (!value.enabled && !value.commitSyncEnabled && !value.eodReminderEnabled) ||
      value.telegramGroupChatId !== null,
    {
      message: 'Выберите Telegram-группу для рассылки',
      path: ['telegramGroupChatId'],
    },
  )
  .refine(
    (value) =>
      (!value.enabled && !value.commitSyncEnabled && !value.eodReminderEnabled) ||
      value.projectMode === 'all' ||
      value.projectIds.length > 0,
    {
      message: 'Выберите хотя бы один проект',
      path: ['projectIds'],
    },
  )
  .refine(
    (value) =>
      !value.enabled ||
      value.recipientMode === 'all' ||
      value.recipientUserIds.length > 0,
    {
      message: 'Выберите хотя бы одного получателя',
      path: ['recipientUserIds'],
    },
  )
  .transform((value) => {
    const daysOfWeek = normalizeScheduleDays(
      value.daysOfWeek,
      value.weekdaysOnly ? WEEKDAY_SCHEDULE_DAYS : ALL_SCHEDULE_DAYS,
    );
    return { ...value, daysOfWeek, weekdaysOnly: isWeekdaysOnly(daysOfWeek) };
  });

export const resolveWorkspaceTelegramGroupSchema = z.object({
  chatId: z.number().int(),
});

export const createWorkspaceInviteSchema = z.object({
  role: z.enum(['editor', 'viewer']),
  // Информационный email «для кого» — опционален; пустая строка → null.
  email: z
    .string()
    .trim()
    .email('Невалидный email')
    .max(255)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});
