import type {
  MonitoringServer,
  ServerConfigInput,
  ServerWithLatest,
} from '@/domain/monitoring/Server';
import type {
  LogKind,
  LogTail,
  ServerSnapshot,
  TrendPoint,
} from '@/domain/monitoring/Snapshot';
import type { AlertRule, ServerAlert } from '@/domain/monitoring/Alert';
import type { HistoryOptions, MonitoringRepository } from '@/application/monitoring/MonitoringRepository';
import { httpClient } from './httpClient';

// Сервер отдаёт даты как ISO-строки → маппим в Date на границе адаптера.
type RawServer = Omit<MonitoringServer, 'lastSnapshotAt' | 'mutedUntil'> & {
  lastSnapshotAt: string | null;
  mutedUntil: string | null;
};
type RawSnapshot = Omit<ServerSnapshot, 'collectedAt'> & { collectedAt: string };
type RawAlert = Omit<ServerAlert, 'firstSeenAt' | 'lastSeenAt' | 'resolvedAt'> & {
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};
type RawTrend = Omit<TrendPoint, 'collectedAt'> & { collectedAt: string };

function mapServer(r: RawServer): MonitoringServer {
  return {
    ...r,
    lastSnapshotAt: r.lastSnapshotAt ? new Date(r.lastSnapshotAt) : null,
    mutedUntil: r.mutedUntil ? new Date(r.mutedUntil) : null,
  };
}
function mapSnapshot(r: RawSnapshot | null): ServerSnapshot | null {
  return r ? { ...r, collectedAt: new Date(r.collectedAt) } : null;
}
function mapAlert(r: RawAlert): ServerAlert {
  return {
    ...r,
    firstSeenAt: new Date(r.firstSeenAt),
    lastSeenAt: new Date(r.lastSeenAt),
    resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
  };
}

export class HttpMonitoringRepository implements MonitoringRepository {
  async listServers(projectId: string): Promise<ServerWithLatest[]> {
    const { servers } = await httpClient.get<{ servers: { server: RawServer; latest: RawSnapshot | null }[] }>(
      `/projects/${projectId}/monitoring/servers`,
    );
    return servers.map((s) => ({ server: mapServer(s.server), latest: mapSnapshot(s.latest) }));
  }

  async getLatest(projectId: string, serverId: string): Promise<ServerSnapshot | null> {
    const { snapshot } = await httpClient.get<{ snapshot: RawSnapshot | null }>(
      `/projects/${projectId}/monitoring/servers/${serverId}/latest`,
    );
    return mapSnapshot(snapshot);
  }

  async getHistory(
    projectId: string,
    serverId: string,
    opts?: HistoryOptions,
  ): Promise<TrendPoint[]> {
    const params = new URLSearchParams();
    if (opts?.since) params.set('since', opts.since.toISOString());
    if (opts?.until) params.set('until', opts.until.toISOString());
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const { points } = await httpClient.get<{ points: RawTrend[] }>(
      `/projects/${projectId}/monitoring/servers/${serverId}/history${qs ? `?${qs}` : ''}`,
    );
    return points.map((p) => ({ ...p, collectedAt: new Date(p.collectedAt) }));
  }

  async getLogs(projectId: string, serverId: string, kind: LogKind): Promise<LogTail | null> {
    const { log } = await httpClient.get<{ log: LogTail | null }>(
      `/projects/${projectId}/monitoring/servers/${serverId}/logs?kind=${kind}`,
    );
    return log;
  }

  async listAlerts(projectId: string, activeOnly: boolean): Promise<ServerAlert[]> {
    const { alerts } = await httpClient.get<{ alerts: RawAlert[] }>(
      `/projects/${projectId}/monitoring/alerts${activeOnly ? '?active=1' : ''}`,
    );
    return alerts.map(mapAlert);
  }

  async triggerCollect(projectId: string, serverId: string): Promise<ServerSnapshot> {
    const { snapshot } = await httpClient.post<{ snapshot: RawSnapshot }>(
      `/projects/${projectId}/monitoring/servers/${serverId}/collect`,
    );
    return mapSnapshot(snapshot) as ServerSnapshot;
  }

  async createServer(projectId: string, input: ServerConfigInput): Promise<MonitoringServer> {
    const { server } = await httpClient.post<{ server: RawServer }>(
      `/projects/${projectId}/monitoring/servers`,
      input,
    );
    return mapServer(server);
  }

  async updateServer(
    projectId: string,
    serverId: string,
    input: ServerConfigInput,
  ): Promise<MonitoringServer> {
    const { server } = await httpClient.patch<{ server: RawServer }>(
      `/projects/${projectId}/monitoring/servers/${serverId}`,
      input,
    );
    return mapServer(server);
  }

  async deleteServer(projectId: string, serverId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/monitoring/servers/${serverId}`);
  }

  async muteServer(projectId: string, serverId: string, minutes: number | null): Promise<MonitoringServer> {
    const { server } = await httpClient.post<{ server: RawServer }>(
      `/projects/${projectId}/monitoring/servers/${serverId}/mute`,
      { minutes },
    );
    return mapServer(server);
  }

  async getAlertRules(projectId: string): Promise<AlertRule[]> {
    const { rules } = await httpClient.get<{ rules: AlertRule[] }>(
      `/projects/${projectId}/monitoring/alert-rules`,
    );
    return rules;
  }

  async saveAlertRules(projectId: string, rules: AlertRule[]): Promise<AlertRule[]> {
    const res = await httpClient.put<{ rules: AlertRule[] }>(
      `/projects/${projectId}/monitoring/alert-rules`,
      { rules },
    );
    return res.rules;
  }
}
