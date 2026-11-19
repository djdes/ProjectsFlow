import type { DesktopNote, DesktopNotesState } from '@/domain/desktop-notes/DesktopNote';

export interface DesktopNotesRepository {
  list(): Promise<DesktopNotesState>;
  pin(taskId: string): Promise<DesktopNote>;
  unpin(taskId: string): Promise<void>;
}
