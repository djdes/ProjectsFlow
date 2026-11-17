import type { TaskPriority, TaskType } from './Task.js';
import type { TaskRecurrence } from './TaskRecurrence.js';
import { taskTitleExcerpt } from './taskExcerpt.js';

// Шаблон задачи пространства (db/187): текст задачи с чеклистом, приоритет, тип и повтор.
// Mirrors client/src/domain/task/WorkspaceTaskTemplate.ts.
export type WorkspaceTaskTemplate = {
  readonly id: string;
  readonly workspaceId: string;
  // Подпись в списке шаблонов. По умолчанию — название задачи (первая строка текста).
  readonly name: string;
  readonly description: string;
  readonly priority: TaskPriority | null;
  readonly taskType: TaskType | null;
  readonly recurrence: TaskRecurrence | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
};

export const TASK_TEMPLATE_NAME_MAX = 120;

/** Имя шаблона: заданное человеком, иначе название задачи; не длиннее колонки. */
export function taskTemplateName(name: string | null | undefined, description: string): string {
  const source = name?.trim() || taskTitleExcerpt(description).trim() || 'Шаблон задачи';
  return source.length > TASK_TEMPLATE_NAME_MAX
    ? `${source.slice(0, TASK_TEMPLATE_NAME_MAX - 1).trimEnd()}…`
    : source;
}
