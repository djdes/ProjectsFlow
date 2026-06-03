import type {
  MonitoringServer,
  OverviewProject,
  ServerConfigInput,
  ServerWithLatest,
} from '@/domain/monitoring/Server';
import type {
  LogKind,
  LogTail,
  ServerSnapshot,
  TrendPoint,
} from '@/domain/monitoring/Snapshot';
import type { AlertCenter, AlertCenterEntry, AlertRule, ServerAlert } from '@/domain/monitoring/Alert';
import type { MonitoringAnalysisResult, MonitoringAnalysisType } from '@/domain/monitoring/Analysis';
import type { HistoryOptions, MonitoringRepository } from '@/application/monitoring/MonitoringRepository';
import { HttpError, httpClient } from './httpClient';

type RawAnalysis = {
  jobId: string;
  serverId: string;
  status: MonitoringAnalysisResult['status'];
  analysisType: MonitoringAnalysisType;
  resultMarkdown: string | null;
  error: string | null;
  costUsd: number | null;
  createdAt: string;
  finishedAt: string | null;
};

function mapAnalysis(r: RawAnalysis): MonitoringAnalysisResult {
  return {
    jobId: r.jobId,
    serverId: r.serverId,
    status: r.status,
    analysisType: r.analysisType,
    resultMarkdown: r.resultMarkdown,
    error: r.error,
    costUsd: r.costUsd,
    createdAt: new Date(r.createdAt),
    finishedAt: r.finishedAt ? new Date(r.finishedAt) : null,
  };
}

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

  async getOverview(): Promise<OverviewProject[]> {
    type RawOv = Omit<OverviewProject, 'servers'> & {
      servers: { id: string; name: string; kind: 'local' | 'remote'; status: OverviewProject['servers'][number]['status']; lastSnapshotAt: string | null }[];
    };
    const { projects } = await httpClient.get<{ projects: RawOv[] }>(`/monitoring/overview`);
    return projects.map((p) => ({
      ...p,
      servers: p.servers.map((s) => ({
        ...s,
        lastSnapshotAt: s.lastSnapshotAt ? new Date(s.lastSnapshotAt) : null,
      })),
    }));
  }

  async getAlertCenter(): Promise<AlertCenter> {
    type RawEntry = Omit<AlertCenterEntry, 'firstSeenAt' | 'lastSeenAt' | 'resolvedAt'> & {
      firstSeenAt: string;
      lastSeenAt: string;
      resolvedAt: string | null;
    };
    const map = (e: RawEntry): AlertCenterEntry => ({
      ...e,
      firstSeenAt: new Date(e.firstSeenAt),
      lastSeenAt: new Date(e.lastSeenAt),
      resolvedAt: e.resolvedAt ? new Date(e.resolvedAt) : null,
    });
    const { active, recent } = await httpClient.get<{ active: RawEntry[]; recent: RawEntry[] }>(
      `/monitoring/alerts`,
    );
    return { active: active.map(map), recent: recent.map(map) };
  }

  async enqueueAnalysis(
    projectId: string,
    serverId: string,
    analysisType: MonitoringAnalysisType,
  ): Promise<{ jobId: string }> {
    const res = await httpClient.post<{ jobId: string }>(`/monitoring/analysis-jobs`, {
      projectId,
      serverId,
      analysisType,
    });
    return { jobId: res.jobId };
  }

  async waitAnalysis(jobId: string, waitSeconds = 50): Promise<MonitoringAnalysisResult> {
    try {
      const r = await httpClient.get<RawAnalysis>(
        `/monitoring/analysis-jobs/${encodeURIComponent(jobId)}?wait=${waitSeconds}`,
      );
      return mapAnalysis(r);
    } catch (e) {
      // 504 — long-poll истёк, анализ ещё идёт. Возвращаем «running», вызывающий повторит.
      if (e instanceof HttpError && e.status === 504) {
        return {
          jobId,
          serverId: '',
          status: 'running',
          analysisType: 'snapshot',
          resultMarkdown: null,
          error: null,
          costUsd: null,
          createdAt: new Date(),
          finishedAt: null,
        };
      }
      throw e;
    }
  }

  async listAnalysisHistory(projectId: string, serverId: string): Promise<MonitoringAnalysisResult[]> {
    const params = new URLSearchParams({ projectId, serverId });
    const { jobs } = await httpClient.get<{ jobs: RawAnalysis[] }>(
      `/monitoring/analysis-history?${params.toString()}`,
    );
    return jobs.map(mapAnalysis);
  }
}
