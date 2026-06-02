import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { TrendPoint } from '@/domain/monitoring/Snapshot';

// Грузит историю метрик сервера за последние rangeHours часов (для графиков трендов).
export function useMonitoringTrends(
  projectId: string,
  serverId: string,
  rangeHours: number,
): { points: TrendPoint[] | null; loading: boolean } {
  const { monitoringRepository } = useContainer();
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const since = new Date(Date.now() - rangeHours * 3600 * 1000);
    monitoringRepository
      .getHistory(projectId, serverId, { since, limit: 2000 })
      .then((p) => {
        if (!cancelled) setPoints(p);
      })
      .catch(() => {
        if (!cancelled) setPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [monitoringRepository, projectId, serverId, rangeHours]);

  return { points, loading };
}
