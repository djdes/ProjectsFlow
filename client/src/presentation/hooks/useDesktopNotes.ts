import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { DesktopNotesRepository } from '@/application/desktop-notes/DesktopNotesRepository';
import type { DesktopNote, DesktopNotesState } from '@/domain/desktop-notes/DesktopNote';
import { useContainer } from '@/infrastructure/di/container';

// Общее на всё приложение состояние «закреплено на экране»: кнопка в окне задачи и страница
// приложения заметок видят одни и те же данные. Загружается один раз, дальше правится локально.
let state: DesktopNotesState | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach((l) => l());
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = (): DesktopNotesState | null => state;

function load(repo: DesktopNotesRepository, force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = repo
    .list()
    .then((next) => {
      state = next;
      emit();
    })
    .catch(() => {
      // Без списка кнопка просто покажет «не закреплено»; следующий заход повторит запрос.
      loading = null;
    });
  return loading;
}

export function useDesktopNotes(): {
  readonly state: DesktopNotesState | null;
  readonly isPinned: (taskId: string) => boolean;
  // Возвращает свежее состояние: по нему видно, запущено ли приложение прямо сейчас.
  readonly pin: (taskId: string) => Promise<DesktopNotesState>;
  readonly unpin: (taskId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
} {
  const { desktopNotesRepository: repo } = useContainer();
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    void load(repo);
  }, [repo]);

  const pin = useCallback(
    async (taskId: string) => {
      const note: DesktopNote = await repo.pin(taskId);
      const base = state ?? { notes: [], appLastSeenAt: null };
      state = { ...base, notes: [...base.notes.filter((n) => n.taskId !== taskId), note] };
      emit();
      try {
        state = await repo.list();
        emit();
      } catch {
        // Закрепление уже прошло; без свежего списка обойдёмся локальным.
      }
      return state;
    },
    [repo],
  );

  const unpin = useCallback(
    async (taskId: string) => {
      await repo.unpin(taskId);
      if (state) {
        state = { ...state, notes: state.notes.filter((n) => n.taskId !== taskId) };
        emit();
      }
    },
    [repo],
  );

  const isPinned = useCallback(
    (taskId: string) => current?.notes.some((n) => n.taskId === taskId) ?? false,
    [current],
  );

  const refresh = useCallback(() => load(repo, true), [repo]);

  return { state: current, isPinned, pin, unpin, refresh };
}
