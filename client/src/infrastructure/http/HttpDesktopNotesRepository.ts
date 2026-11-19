import type { DesktopNotesRepository } from '@/application/desktop-notes/DesktopNotesRepository';
import type { DesktopNote, DesktopNotesState } from '@/domain/desktop-notes/DesktopNote';
import { httpClient } from './httpClient';

export class HttpDesktopNotesRepository implements DesktopNotesRepository {
  async list(): Promise<DesktopNotesState> {
    const dto = await httpClient.get<{ notes: DesktopNote[]; appLastSeenAt: string | null }>('/desktop-notes');
    return { notes: dto.notes ?? [], appLastSeenAt: dto.appLastSeenAt ? new Date(dto.appLastSeenAt) : null };
  }

  async pin(taskId: string): Promise<DesktopNote> {
    const { note } = await httpClient.put<{ note: DesktopNote }>(`/desktop-notes/${encodeURIComponent(taskId)}`);
    return note;
  }

  async unpin(taskId: string): Promise<void> {
    await httpClient.delete<void>(`/desktop-notes/${encodeURIComponent(taskId)}`);
  }
}
