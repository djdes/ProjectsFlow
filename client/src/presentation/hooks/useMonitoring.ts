import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { HttpError } from '@/lib/HttpError';
import type { ServerWithLatest } from '@/domain/monitoring/Server';
import type { ServerAlert } from '@/domain/monitoring/Alert';

export type MonitoringState = {
  servers: ServerWithLatest[] | null;
  alerts: ServerAlert[];
  loading: boolean;
  error: Error | null;
  forbidden: boolean;
  lastUpdated: Date | null;
  reload: () => void;
};

// Загружает серверы + активные алерты и поллит с интервалом (пауза на скрытой вкладке).
// forbidden=true → у юзера нет доступа (не owner/admin) — страница покажет отказ.
export function useMonitoring(projectId: string, pollMs = 15000): MonitoringState {
  const { monitoringRepository } = useContainer();
  const [servers, setServers] = useState<ServerWithLatest[] | null>(null);
  const [alerts, setAlerts] = useState<ServerAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async (): Promise<void> => {
      try {
        const [s, a] = await Promise.all([
          monitoringRepository.listServers(projectId),
          monitoringRepository.listAlerts(projectId, true),
        ]);
        if (cancelled) return;
        setServers(s);
        setAlerts(a);
        setForbidden(false);
        setError(null);
        setLastUpdated(new Date());
      } catch (e) {
        if (cancelled) return;
        if (e instanceof HttpError && (e.status === 403 || e.status === 404)) {
          setForbidden(true);
        } else {
          setError(e as Error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const loop = async (): Promise<void> => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (!hidden) await load();
      if (!cancelled) timer = setTimeout(() => void loop(), pollMs);
    };

    setLoading(true);
    void loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [monitoringRepository, projectId, pollMs, version]);

  return {
    servers,
    alerts,
    loading,
    error,
    forbidden,
    lastUpdated,
    reload: () => setVersion((v) => v + 1),
  };
}
