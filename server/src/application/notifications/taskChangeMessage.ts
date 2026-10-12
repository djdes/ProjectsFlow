import { taskChangeAction, type TaskChange, type TaskChangeAction } from '../../domain/notifications/TaskChange.js';
import { STATUS_LABEL as TASK_STATUS_LABEL } from '../../domain/task/statusLabels.js';

const ACTION_LABELS: Record<TaskChangeAction, string> = {
  created: 'Создана задача', updated: 'Задача изменена', approval_requested: 'Задача ждёт утверждения',
  approved: 'Задача принята', completed: 'Задача завершена', returned: 'Задача возвращена на доработку',
  withdrawn: 'Задача отозвана с утверждения', reopened: 'Задача возвращена в работу',
  status_changed: 'Изменён статус задачи', assigned: 'Изменён исполнитель', moved: 'Задача перенесена',
  deleted: 'Задача удалена', restored: 'Задача восстановлена',
};

function date(value: string | null | undefined): string {
  return value ? value.split('-').reverse().join('.') : 'не указан';
}

export function taskChangeMessage(change: TaskChange, projectName: string, previousProjectName?: string) {
  const { task, previous, changedFields: fields } = change;
  const action = taskChangeAction(change);
  const details: string[] = [];
  if (fields.includes('deadline')) {
    if (previous?.deadline !== task.deadline) details.push(`Срок до: ${date(previous?.deadline)} → ${date(task.deadline)}`);
    if (previous?.startDate !== task.startDate) details.push(`Дата начала: ${date(previous?.startDate)} → ${date(task.startDate)}`);
  }
  if (fields.includes('assignee')) details.push(`Исполнитель: ${previous?.assignee.displayName ?? '—'} → ${task.assignee.displayName}`);
  if (fields.includes('status') && previous?.status !== task.status) {
    details.push(`Статус: ${previous ? TASK_STATUS_LABEL[previous.status] : '—'} → ${TASK_STATUS_LABEL[task.status]}`);
  }
  if (fields.includes('project')) details.push(`Проект: ${previousProjectName ?? '—'} → ${projectName}`);
  const labels = {
    description: 'Изменены название или описание', priority: 'Изменён приоритет',
    taskType: 'Изменён тип задачи', ralphMode: 'Изменён режим', appearance: 'Изменено оформление',
    parent: 'Изменена родительская задача', cancellation: 'Изменён запрос остановки воркера',
    files: 'Изменены вложения', customProperties: 'Изменены свойства', commits: 'Изменены связанные коммиты',
  };
  for (const [field, label] of Object.entries(labels)) {
    if (fields.includes(field as keyof typeof labels)) details.push(label);
  }
  if (action === 'created') {
    details.push(`Исполнитель: ${task.assignee.displayName}`, `Срок до: ${date(task.deadline)}`);
  }
  return { action, title: ACTION_LABELS[action], detail: details.join('\n') };
}
