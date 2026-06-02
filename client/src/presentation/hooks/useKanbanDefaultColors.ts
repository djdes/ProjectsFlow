import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { toast } from '@/components/ui/sonner';
import type {
  KanbanColor,
  KanbanDefaultColors,
  VisibleKanbanStatus,
} from '@/domain/kanban/KanbanSettings';

// Глобальные дефолтные цвета канбан-колонок (профиль). Применяются как fallback ко всем
// проектам юзера (только для НОВЫХ — существующие резолвят свой per-project цвет поверх).
// Оптимистичное обновление с откатом + toast, по образцу NotificationDefaultsCard.
export function useKanbanDefaultColors(): {
  colors: KanbanDefaultColors | null;
  loading: boolean;
  setColor: (status: VisibleKanbanStatus, color: KanbanColor) => void;
} {
  const { userRepository } = useContainer();
  const [colors, setColors] = useState<KanbanDefaultColors | null>(null);

  useEffect(() => {
    let cancelled = false;
    userRepository
      .getDefaultKanbanColors()
      .then((c) => {
        if (!cancelled) setColors(c);
      })
      .catch(() => {
        if (!cancelled) setColors({});
      });
    return () => {
      cancelled = true;
    };
  }, [userRepository]);

  const setColor = useCallback(
    (status: VisibleKanbanStatus, color: KanbanColor) => {
      setColors((prev) => {
        const next: KanbanDefaultColors = { ...(prev ?? {}), [status]: color };
        userRepository.setDefaultKanbanColors(next).catch(() => {
          setColors(prev);
          toast.error('Не удалось сохранить цвет');
        });
        return next;
      });
    },
    [userRepository],
  );

  return { colors, loading: colors === null, setColor };
}
