import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { toast } from '@/components/ui/sonner';
import type {
  NotificationPrefs,
  NotifEventType,
  NotifSource,
} from '@/domain/notifications/NotificationPrefs';
import { resolvePref } from '@/domain/notifications/NotificationPrefs';

// Загружает и обновляет пер-участниковые настройки оповещений по проекту. Тоггл —
// оптимистичный, с откатом и toast при ошибке.
export function useNotificationPrefs(projectId: string): {
  prefs: NotificationPrefs | null;
  loading: boolean;
  toggle: (type: NotifEventType, source: NotifSource, value: boolean) => void;
} {
  const { projectRepository } = useContainer();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectRepository
      .getNotificationPrefs(projectId)
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch(() => {
        if (!cancelled) setPrefs({});
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId]);

  const toggle = useCallback(
    (type: NotifEventType, source: NotifSource, value: boolean) => {
      setPrefs((prev) => {
        const base = prev ?? {};
        // Полностью материализуем entry (резолвим текущее эффективное значение второй оси),
        // чтобы PUT сохранил обе оси осознанно, а не «дефолт».
        const current = base[type] ?? {
          team: resolvePref(base, type, 'team'),
          mcp: resolvePref(base, type, 'mcp'),
        };
        const nextEntry = { ...current, [source]: value };
        const next: NotificationPrefs = { ...base, [type]: nextEntry };
        // Сохраняем; при ошибке — откат к prev + toast.
        projectRepository.setNotificationPrefs(projectId, next).catch(() => {
          setPrefs(prev);
          toast.error('Не удалось сохранить настройку оповещений');
        });
        return next;
      });
    },
    [projectRepository, projectId],
  );

  return { prefs, loading: prefs === null, toggle };
}
