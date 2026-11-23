import { useEffect, useRef } from 'react';
import { TASK_CHANGED_EVENT } from './useNotificationStream';
import { onTabReturn } from '@/lib/tabReturn';

// Live-обновление задач без перезагрузки. Слушает SSE-событие об изменении задач в
// проекте (ретранслированное через window) и рефетчит, если projectId совпадает.
// Debounce коалесцирует серию событий и гасит «эхо» собственных мутаций (мерцание).
// Refetch при возврате на вкладку (после заметного отсутствия, lib/tabReturn) — safety-net
// на случай пропущенных SSE-событий.
export function useRealtimeTaskRefresh(projectId: string, refetch: () => void): void {
  // refetch в ref, чтобы не пересоздавать слушателей при каждом ререндере.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    if (!projectId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refetchRef.current(), 350);
    };

    const onTaskChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId === projectId) schedule();
    };
    window.addEventListener(TASK_CHANGED_EVENT, onTaskChanged);
    const stopTabReturn = onTabReturn(schedule);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(TASK_CHANGED_EVENT, onTaskChanged);
      stopTabReturn();
    };
  }, [projectId]);
}
