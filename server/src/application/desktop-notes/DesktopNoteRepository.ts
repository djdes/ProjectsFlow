// Закреплённые «на экран» задачи и отметка, когда приложение заметок было на связи.
export type DesktopNoteApp = {
  readonly lastSeenAt: Date;
  readonly appVersion: string | null;
};

export interface DesktopNoteRepository {
  // id задач в порядке закрепления (старые первыми).
  listPinnedTaskIds(userId: string): Promise<string[]>;
  pin(userId: string, taskId: string): Promise<void>;
  unpin(userId: string, taskId: string): Promise<void>;
  touchApp(userId: string, appVersion: string | null): Promise<void>;
  getApp(userId: string): Promise<DesktopNoteApp | null>;
}
