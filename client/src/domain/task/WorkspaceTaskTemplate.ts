import type { TaskPriority, TaskType } from './Task';
import type { WorkspaceRole } from '../workspace/Workspace';
import { PRIORITY_META } from './priorityMeta';
import { TASK_TYPE_META } from './taskTypeMeta';
import { taskRecurrenceLabel, type TaskRecurrence } from './TaskRecurrence';

// Шаблон задачи пространства (db/187): текст задачи с чеклистом, приоритет, тип и повтор.
// «Сохранить как шаблон» — в меню «⋯» окна задачи; выбор — «Шаблон» в окне «Новая задача».
// Mirrors server/src/domain/task/WorkspaceTaskTemplate.ts.
export type WorkspaceTaskTemplate = {
  readonly id: string;
  readonly workspaceId: string;
  // Подпись в списке. По умолчанию — название задачи.
  readonly name: string;
  readonly description: string;
  readonly priority: TaskPriority | null;
  readonly taskType: TaskType | null;
  readonly recurrence: TaskRecurrence | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
};

/** Удалять шаблон может его автор, руководитель или владелец пространства (так же решает сервер). */
export function canDeleteTaskTemplate(
  template: WorkspaceTaskTemplate,
  userId: string | null | undefined,
  role: WorkspaceRole | null | undefined,
): boolean {
  return role === 'owner' || role === 'lead' || (!!userId && template.createdBy === userId);
}

/** Строка-пояснение под именем шаблона: «Высокий · Фича · Каждый день · чеклист 3». */
export function taskTemplateSummary(template: WorkspaceTaskTemplate): string {
  const parts: string[] = [];
  if (template.priority !== null) parts.push(PRIORITY_META[template.priority].label);
  if (template.taskType !== null) parts.push(TASK_TYPE_META[template.taskType].label);
  if (template.recurrence) parts.push(taskRecurrenceLabel(template.recurrence));
  const checklist = template.description.split('\n').filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/u.test(line)).length;
  if (checklist > 0) parts.push(`чеклист ${checklist}`);
  return parts.join(' · ');
}
