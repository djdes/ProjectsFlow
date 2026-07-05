import { z } from 'zod';

export const taskStatusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
  'manual',
]);

// Режим работы Ralph. См. spec C:/www/ralph/prompts/task-ralph-mode.md.
export const ralphModeSchema = z.enum(['normal', 'silent', 'grillme']);

// Дата 'YYYY-MM-DD' (без времени). Жёсткий regex — backend хранит как есть, UI парсит
// для отображения. nullable: null = очистить deadline; не передано = не менять.
const deadlineSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Дата должна быть в формате YYYY-MM-DD')
  .nullable();

// Приоритет 1..4 (Todoist style). nullable: null = убрать приоритет.
const prioritySchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  .nullable();

// Иконка задачи: эмодзи / lucide:Name[:color] / data-URL картинки. nullable: null = убрать иконку.
// Лимит 2_000_000 — вмещает base64 data-URL картинки, защищая от гигантского payload'а.
const iconSchema = z.string().max(2_000_000).nullable();

// Обложка задачи: CSS-градиент/пресет или data-URL картинки. nullable: null = убрать обложку.
// Лимит 5_000_000 — вмещает base64 data-URL картинки-обложки, защищая от гигантского payload'а.
const coverSchema = z.string().max(5_000_000).nullable();

// Вертикальное положение фокуса обложки (0..100), как у проекта. 50 = центр.
const coverPositionSchema = z.number().int().min(0).max(100);

export const createTaskSchema = z.object({
  // Лимит 50000 — фактически «без ограничения по объёму» для задач автоматизации
  // (крупные/сложные ТЗ). Колонка tasks.description — MEDIUMTEXT (db/058).
  description: z.string().trim().min(1, 'Введите описание').max(50000),
  icon: iconSchema.optional(),
  cover: coverSchema.optional(),
  coverPosition: coverPositionSchema.optional(),
  status: taskStatusSchema.optional(),
  // Позиция: поставить новую задачу сразу ПОСЛЕ этой (цепочка inline-создания). Только на create.
  afterTaskId: z.string().uuid().nullable().optional(),
  ralphMode: ralphModeSchema.optional(),
  // Опциональное one-to-one делегирование (только для inbox-задач). UUID юзера.
  // Сервер дополнительно валидирует: не self, в shared-members caller'а, проект isInbox.
  delegateUserId: z.string().uuid().nullable().optional(),
  deadline: deadlineSchema.optional(),
  priority: prioritySchema.optional(),
});

export const updateTaskSchema = z
  .object({
    description: z.string().trim().min(1).max(50000).optional(),
    icon: iconSchema.optional(),
    cover: coverSchema.optional(),
    coverPosition: coverPositionSchema.optional(),
    ralphMode: ralphModeSchema.optional(),
    deadline: deadlineSchema.optional(),
    priority: prioritySchema.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Нечего обновлять' });

export const moveTaskSchema = z.object({
  targetStatus: taskStatusSchema,
  beforeTaskId: z.string().nullable(),
  afterTaskId: z.string().nullable(),
  // Снятие галочки «выполнено»: вернуть прежний статус (status_before_done), а не
  // targetStatus — сервер сам резолвит. См. MoveTask, db/055.
  restore: z.boolean().optional(),
});

// Полный SHA — 40 hex. Принимаем и короткий (минимум 7) — GitHub API сам резолвит.
export const linkCommitSchema = z.object({
  sha: z.string().trim().regex(/^[0-9a-f]{7,40}$/i, { message: 'Невалидный SHA коммита' }),
});

// Адресация уведомления из композера. mode='all' (по умолчанию) — все участники;
// 'selected' — только userIds; 'none' — никого. См. db/047 + DispatchCommentNotifications.
export const notifyAudienceSchema = z.object({
  mode: z.enum(['all', 'selected', 'none']),
  userIds: z.array(z.string().uuid()).max(200).optional(),
});

// Лимит 10000 символов — на пару порядков больше типичного комментария, но защищает
// от случайной вставки гигантского лога.
export const createTaskCommentSchema = z.object({
  body: z.string().trim().min(1, 'Введите текст комментария').max(10000),
  // Опционально: старые клиенты без поля → дефолт 'all' на роуте.
  notify: notifyAudienceSchema.optional(),
  // Ответ/цитата (db/080). Опциональны → старые клиенты не присылают.
  replyToCommentId: z.string().min(1).max(64).nullable().optional(),
  quotedText: z.string().max(2000).nullable().optional(),
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

// POST /:taskId/assign-to-project — перенос inbox-задачи в реальный проект.
export const assignToProjectSchema = z.object({
  targetProjectId: z.string().uuid(),
});

// POST /:taskId/delegate — делегировать уже созданную inbox-задачу.
export const delegateTaskSchema = z.object({
  delegateUserId: z.string().uuid(),
});

// POST /digest — экспорт выбранных задач (буфер / email / Telegram).
const digestRecipientSchema = z.union([
  z.object({ kind: z.literal('self') }),
  z.object({ kind: z.literal('user'), userId: z.string().uuid() }),
  z.object({ kind: z.literal('group') }),
]);

export const exportDigestSchema = z
  .object({
    taskIds: z.array(z.string().uuid()).min(1).max(500),
    channel: z.enum(['clipboard', 'email', 'telegram']),
    recipients: z.array(digestRecipientSchema).max(50).optional(),
  })
  .refine((o) => o.channel === 'clipboard' || (o.recipients?.length ?? 0) > 0, {
    message: 'Для отправки укажите хотя бы одного получателя',
    path: ['recipients'],
  });

export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type MoveTaskBody = z.infer<typeof moveTaskSchema>;
export type LinkCommitBody = z.infer<typeof linkCommitSchema>;
export type CreateTaskCommentBody = z.infer<typeof createTaskCommentSchema>;
export type CreateAgentTaskCommentBody = z.infer<typeof createAgentTaskCommentSchema>;
export type UpdateTaskCommentBody = z.infer<typeof updateTaskCommentSchema>;
