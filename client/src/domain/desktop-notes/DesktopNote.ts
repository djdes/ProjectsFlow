import type { TaskPriority, TaskStatus } from '@/domain/task/Task';

// Задача, закреплённая «на экран»: приложение «ProjectsFlow Заметки» для Windows показывает
// её стикером поверх окон.
export type DesktopNote = {
  readonly taskId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly title: string;
  readonly excerpt: string;
  readonly status: TaskStatus;
  readonly statusLabel: string;
  readonly statusOptions: ReadonlyArray<{ readonly status: TaskStatus; readonly label: string }>;
  readonly canEdit: boolean;
  readonly deadline: string | null;
  readonly priority: TaskPriority | null;
  readonly path: string;
};

export type DesktopNotesState = {
  readonly notes: DesktopNote[];
  // Когда приложение последний раз было на связи; null — ни разу не подключалось.
  readonly appLastSeenAt: Date | null;
};

// Приложение опрашивает сервер каждые несколько секунд; две минуты тишины — оно выключено.
export const DESKTOP_APP_ONLINE_MS = 2 * 60 * 1000;

export function isDesktopAppOnline(state: DesktopNotesState, now: number): boolean {
  return state.appLastSeenAt !== null && now - state.appLastSeenAt.getTime() < DESKTOP_APP_ONLINE_MS;
}

export const DESKTOP_NOTES_DOWNLOAD_URL = '/downloads/ProjectsFlowNotes.exe';
