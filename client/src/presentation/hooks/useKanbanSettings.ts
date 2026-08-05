import { useCallback, useEffect, useRef, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { toast } from '@/components/ui/sonner';
import type {
  KanbanBoardSettings,
  KanbanColor,
  KanbanColumnSettings,
  KanbanDefaultColors,
  CustomKanbanSlot,
  KanbanColumnStatus,
} from '@/domain/kanban/KanbanSettings';

// Загружает ОБЩИЕ (на весь проект) настройки канбан-доски + персональные дефолтные цвета юзера.
// Изменения оптимистичны: локальное состояние обновляется сразу, PUT уходит в фоне (для label —
// дебаунс, чтобы не слать запрос на каждый символ), при ошибке — откат + toast.
export function useKanbanSettings(projectId: string): {
  settings: KanbanBoardSettings | null;
  defaults: KanbanDefaultColors | null;
  loading: boolean;
  setColor: (status: KanbanColumnStatus, color: KanbanColor) => void;
  setLabel: (status: KanbanColumnStatus, label: string) => void;
  setHidden: (status: KanbanColumnStatus, hidden: boolean) => void;
  // Кастомные колонки (db/154). Слот выбирает сервер, поэтому здесь без optimistic:
  // ждём ответ и берём из него авторитетную карту настроек.
  createColumn: (label: string) => Promise<CustomKanbanSlot | null>;
  deleteColumn: (slot: CustomKanbanSlot) => Promise<boolean>;
} {
  const { projectRepository, userRepository } = useContainer();
  const [settings, setSettings] = useState<KanbanBoardSettings | null>(null);
  const [defaults, setDefaults] = useState<KanbanDefaultColors | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectRepository
      .getKanbanSettings(projectId)
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        if (!cancelled) setSettings({});
      });
    userRepository
      .getDefaultKanbanColors()
      .then((d) => {
        if (!cancelled) setDefaults(d);
      })
      .catch(() => {
        if (!cancelled) setDefaults({});
      });
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [projectRepository, userRepository, projectId]);

  const persist = useCallback(
    (next: KanbanBoardSettings, prev: KanbanBoardSettings | null, debounce: boolean) => {
      const doPut = (): void => {
        projectRepository.setKanbanSettings(projectId, next).catch(() => {
          setSettings(prev);
          toast.error('Не удалось сохранить настройки доски');
        });
      };
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (debounce) {
        debounceRef.current = setTimeout(doPut, 400);
      } else {
        doPut();
      }
    },
    [projectRepository, projectId],
  );

  const patchColumn = useCallback(
    (status: KanbanColumnStatus, patch: Partial<KanbanColumnSettings>, debounce: boolean) => {
      setSettings((prev) => {
        const base = prev ?? {};
        const column: KanbanColumnSettings = { ...base[status], ...patch };
        const next: KanbanBoardSettings = { ...base, [status]: column };
        persist(next, prev, debounce);
        return next;
      });
    },
    [persist],
  );

  const setColor = useCallback(
    (status: KanbanColumnStatus, color: KanbanColor) => patchColumn(status, { color }, false),
    [patchColumn],
  );
  const setLabel = useCallback(
    (status: KanbanColumnStatus, label: string) => patchColumn(status, { label }, true),
    [patchColumn],
  );
  const setHidden = useCallback(
    (status: KanbanColumnStatus, hidden: boolean) => patchColumn(status, { hidden }, false),
    [patchColumn],
  );

  const createColumn = useCallback(
    async (label: string): Promise<CustomKanbanSlot | null> => {
      try {
        const res = await projectRepository.createKanbanColumn(projectId, label);
        setSettings(res.settings);
        return res.slot;
      } catch (e) {
        toast.error((e as Error).message || 'Не удалось создать колонку');
        return null;
      }
    },
    [projectRepository, projectId],
  );

  const deleteColumn = useCallback(
    async (slot: CustomKanbanSlot): Promise<boolean> => {
      try {
        const res = await projectRepository.deleteKanbanColumn(projectId, slot);
        setSettings(res.settings);
        if (res.movedTasks > 0) {
          toast.success(`Колонка удалена, задач перенесено в «Черновики»: ${res.movedTasks}`);
        }
        return true;
      } catch (e) {
        toast.error((e as Error).message || 'Не удалось удалить колонку');
        return false;
      }
    },
    [projectRepository, projectId],
  );

  return {
    settings,
    defaults,
    loading: settings === null || defaults === null,
    setColor,
    setLabel,
    setHidden,
    createColumn,
    deleteColumn,
  };
}
