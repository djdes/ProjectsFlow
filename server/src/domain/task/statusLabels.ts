import { isCustomKanbanSlot, type KanbanBoardSettings } from '../kanban/KanbanSettings.js';
import type { TaskStatus } from './Task.js';

/**
 * ЕДИНЫЙ серверный источник подписей статусов задачи.
 *
 * До этого модуля одни и те же строки были продублированы в дайджестах, TG-сообщениях и
 * EOD-напоминании, и копии успели разойтись: 'manual' был «Вручную» в сводках и «В ручную»
 * в телеграме, а слово «В работе» на доске означало колонку 'manual', тогда как здесь —
 * статус 'in_progress'. Теперь «В работе» закреплено ИСКЛЮЧИТЕЛЬНО за 'in_progress', а
 * колонка/полка 'manual' называется так, как её назвали в настройках доски (дефолт «Вручную»).
 *
 * Зеркало client/src/presentation/components/tasks/statusLabels.ts — держим в синхроне.
 */
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Черновики',
  manual: 'Вручную',
  todo: 'Воркер',
  in_progress: 'В работе',
  awaiting_clarification: 'На уточнении',
  pending_approval: 'На утверждении',
  done: 'Готово',
  // Кастомные колонки (db/154): настоящее название живёт в kanban_settings проекта —
  // используй resolveStatusLabel(settings, status), где настройки доступны.
  custom_1: 'Колонка 1',
  custom_2: 'Колонка 2',
  custom_3: 'Колонка 3',
  custom_4: 'Колонка 4',
  custom_5: 'Колонка 5',
};

/**
 * Подпись статуса с учётом настроек доски конкретного проекта: переименованные встроенные
 * колонки и названия кастомных. Без настроек — встроенные подписи.
 */
export function resolveStatusLabel(
  settings: KanbanBoardSettings | null | undefined,
  status: TaskStatus,
): string {
  const custom = settings?.[status as keyof KanbanBoardSettings]?.label?.trim();
  if (custom && custom.length > 0) return custom;
  if (isCustomKanbanSlot(status)) return `Колонка ${status.slice('custom_'.length)}`;
  return STATUS_LABEL[status];
}
