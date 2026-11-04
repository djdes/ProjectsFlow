import type { TaskPriority, TaskStatus } from './Task.js';
import { formatDeadlineRemainingRu } from './digestFormat.js';

// Urgent task reminders: on weekdays at 08:00 and 16:00 MSK the assignee gets a personal
// message and the workspace group gets one message per urgent task.

// Priority 1 «Срочно» and 2 «Высокий» (PRIORITY_DIGEST_META).
export const URGENT_REMINDER_PRIORITIES: readonly TaskPriority[] = [1, 2];

// Open statuses that still need work, drafts included (owner's decision). Not included:
// pending_approval (already handed over to the reviewer), done.
export const URGENT_REMINDER_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'manual',
  'custom_1',
  'custom_2',
  'custom_3',
  'custom_4',
  'custom_5',
];

// «срочно», «Срочная», «СРОЧНО!», «#срочно», «сверхсрочно». The stem must start a word, so
// «несрочно» is not caught; an explicit negation «не срочно» is skipped as well.
const URGENT_WORD = /(?<![\p{L}\p{N}_])(?:сверх)?срочн\p{L}*/giu;
const NEGATION_BEFORE = /(?:^|[^\p{L}\p{N}_])не[\s ]+$/iu;

export function mentionsUrgent(text: string | null): boolean {
  if (!text) return false;
  for (const match of text.matchAll(URGENT_WORD)) {
    const before = text.slice(Math.max(0, match.index - 8), match.index);
    if (!NEGATION_BEFORE.test(before)) return true;
  }
  return false;
}

export function isUrgentTask(task: {
  readonly priority: TaskPriority | null;
  readonly description: string | null;
}): boolean {
  return (
    (task.priority !== null && URGENT_REMINDER_PRIORITIES.includes(task.priority)) ||
    mentionsUrgent(task.description)
  );
}

export function needsUrgentReminder(task: {
  readonly status: TaskStatus;
  readonly priority: TaskPriority | null;
  readonly description: string | null;
}): boolean {
  return URGENT_REMINDER_STATUSES.includes(task.status) && isUrgentTask(task);
}

export const URGENT_REMINDER_HOURS = [8, 16] as const;
// Catch-up window: a process that came up at 08:03 (deploy, restart) still sends the morning
// reminder, but the morning one never goes out in the afternoon.
export const URGENT_REMINDER_CATCH_UP_MINUTES = 120;

export type UrgentReminderSlot = {
  // 'YYYY-MM-DD@HH' — idempotency key together with the task id.
  readonly key: string;
  readonly date: string;
  readonly hour: (typeof URGENT_REMINDER_HOURS)[number];
};

// Moscow wall clock (see infrastructure/scheduler/mskClock.ts).
export type MskWallClock = {
  readonly date: string;
  readonly hour: number;
  readonly minute: number;
  readonly dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
};

export function currentUrgentReminderSlot(now: MskWallClock): UrgentReminderSlot | null {
  if (now.dayOfWeek === 0 || now.dayOfWeek === 6) return null;
  const minutes = now.hour * 60 + now.minute;
  for (const hour of URGENT_REMINDER_HOURS) {
    const start = hour * 60;
    if (minutes >= start && minutes < start + URGENT_REMINDER_CATCH_UP_MINUTES) {
      return { key: `${now.date}@${String(hour).padStart(2, '0')}`, date: now.date, hour };
    }
  }
  return null;
}

// «05.11 · осталось 1 день»; days are counted against the slot's Moscow date.
export function formatUrgentDeadline(deadline: string | null, today: string): string {
  if (!deadline) return 'без дедлайна';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline);
  if (!m) return deadline;
  const remaining = formatDeadlineRemainingRu(deadline, new Date(`${today}T12:00:00`));
  return `${m[3]}.${m[2]} · ${remaining}`;
}
