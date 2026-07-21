import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { UsageSummary } from '@/domain/usage/Usage';
import { useContainer } from '@/infrastructure/di/container';
import { TASK_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';

type UsageContextValue = {
  usage: UsageSummary | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  // Принять свежий usage без запроса (после смены плана сервер уже вернул сводку).
  applyUsage: (u: UsageSummary) => void;
};

const UsageCtx = createContext<UsageContextValue | null>(null);

// Поллинг расхода: окна двигаются на каждом AI-прогоне. Пауза на скрытой вкладке + рефреш
// на возврат фокуса и на активность воркера (TASK_CHANGED_EVENT) держат цифры свежими дёшево.
const POLL_MS = 60_000;

export function UsageProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { getUsage } = useContainer();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const loadSeq = useRef(0);

  const refresh = useCallback(() => {
    const seq = (loadSeq.current += 1);
    getUsage
      .execute()
      .then((u) => {
        if (seq === loadSeq.current) {
          setUsage(u);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setError(e);
      });
  }, [getUsage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const tick = (): void => {
      if (!document.hidden) refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  // Активность воркера двигает задачи → расход изменился. SSE-поток task-событий при
  // активном воркере валит часто, а refresh() ре-рендерит всё дерево (провайдер на верхушке).
  // Жёстко коалесцируем: не чаще раза в 5с (плюс есть периодический polling выше).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, 5000);
    };
    window.addEventListener(TASK_CHANGED_EVENT, schedule);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(TASK_CHANGED_EVENT, schedule);
    };
  }, [refresh]);

  const value: UsageContextValue = {
    usage,
    loading: usage === null && error === null,
    error,
    refresh,
    applyUsage: (u) => setUsage(u),
  };

  return <UsageCtx.Provider value={value}>{children}</UsageCtx.Provider>;
}

export function useUsage(): UsageContextValue {
  const c = useContext(UsageCtx);
  if (!c) throw new Error('useUsage must be used inside <UsageProvider>');
  return c;
}
