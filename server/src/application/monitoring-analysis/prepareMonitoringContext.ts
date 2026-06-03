import type { ServerRepository } from '../monitoring/ServerRepository.js';
import type { SnapshotRepository, TrendPoint } from '../monitoring/SnapshotRepository.js';
import type { MonitoringAlertRepository } from '../monitoring/MonitoringAlertRepository.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type { ServerSnapshot } from '../../domain/monitoring/ServerSnapshot.js';
import type { ServerAlert } from '../../domain/monitoring/Alert.js';
import type { MonitoringAnalysisType } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';

// Cap контекста — режем, чтобы не раздувать вход Claude (≈80K символов).
const MAX_CONTEXT_CHARS = 80_000;
const TREND_POINTS = 30;

export type PrepareContextDeps = {
  readonly servers: ServerRepository;
  readonly snapshots: SnapshotRepository;
  readonly alerts: MonitoringAlertRepository;
};

function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function renderSnapshot(server: ProjectServer, snap: ServerSnapshot | null): string {
  const lines: string[] = [];
  lines.push(`# Сервер: ${server.name} (${server.kind})`);
  if (server.host) lines.push(`Хост: ${server.host}`);
  if (server.healthUrl) lines.push(`Health URL: ${server.healthUrl}`);
  if (!snap) {
    lines.push('\nСнимок отсутствует — метрики не собирались.');
    return lines.join('\n');
  }
  lines.push(`Статус: ${snap.status} · собрано: ${snap.collectedAt.toISOString()} · reachable: ${snap.reachable}`);
  const m = snap.metrics;
  if (m) {
    if (m.http) {
      lines.push(
        `\n## HTTP\n${m.http.url} → ok=${m.http.ok}, code=${m.http.statusCode ?? '—'}, latency=${m.http.latencyMs ?? '—'}мс${m.http.error ? `, error=${m.http.error}` : ''}`,
      );
    }
    if (m.ssl && m.ssl.daysLeft !== null) {
      lines.push(`## SSL\n${m.ssl.host}: осталось ${m.ssl.daysLeft} дн (до ${m.ssl.expiresAt ?? '—'})`);
    }
    if (m.pm2.length > 0) {
      lines.push('\n## pm2');
      for (const p of m.pm2) {
        lines.push(
          `- ${p.name}: ${p.status}, рестартов=${p.restarts ?? '—'}, cpu=${p.cpuPct ?? '—'}%, mem=${fmtBytes(p.memoryBytes)}, uptime=${p.uptimeMs !== null ? Math.round(p.uptimeMs / 1000) + 'с' : '—'}`,
        );
      }
    }
    const s = m.system;
    if (s) {
      lines.push('\n## Система');
      lines.push(
        `load: ${s.load1 ?? '—'}/${s.load5 ?? '—'}/${s.load15 ?? '—'} · cpu=${s.cpuUsedPct ?? '—'}% (${s.cpuCount ?? '—'} ядер)`,
      );
      lines.push(`RAM: ${s.memUsedPct ?? '—'}% (${fmtBytes(s.memUsedBytes)} / ${fmtBytes(s.memTotalBytes)})`);
      if (s.swapTotalBytes) lines.push(`Swap: ${s.swapUsedPct ?? '—'}% (${fmtBytes(s.swapUsedBytes)} / ${fmtBytes(s.swapTotalBytes)})`);
      if (s.netRxBytes != null) lines.push(`Сеть: ↓${fmtBytes(s.netRxBytes)} ↑${fmtBytes(s.netTxBytes)}`);
      if (s.processCount != null) lines.push(`Процессов: ${s.processCount}, FD: ${s.openFds ?? '—'}`);
      for (const d of s.disks) {
        lines.push(`Диск ${d.mount}: ${Math.round(d.usedPct)}% (${fmtBytes(d.usedBytes)} / ${fmtBytes(d.totalBytes)})`);
      }
    }
  }
  const db = snap.dbHealth;
  if (db?.reachable) {
    lines.push(
      `\n## База данных${db.version ? ` (${db.version})` : ''}\nСоединения: ${db.connections ?? '—'}${db.maxConnections ? `/${db.maxConnections}` : ''} · размер: ${fmtBytes(db.sizeBytes)} · slow: ${db.slowQueries ?? '—'}`,
    );
  }
  if (snap.errors && snap.errors.length > 0) {
    lines.push(`\n## Ошибки сбора\n${snap.errors.join('; ')}`);
  }
  return lines.join('\n');
}

function renderAlerts(alerts: ServerAlert[]): string {
  if (alerts.length === 0) return '\n## Активные алерты\nнет';
  return (
    '\n## Активные алерты\n' +
    alerts
      .map((a) => `- [${a.severity}] ${a.ruleKind}: ${a.message} (с ${a.firstSeenAt.toISOString()})`)
      .join('\n')
  );
}

function renderTrend(points: TrendPoint[]): string {
  if (points.length === 0) return '';
  const rows = points
    .slice(-TREND_POINTS)
    .map(
      (p) =>
        `${p.collectedAt.toISOString()} status=${p.status} load1=${p.cpuLoad1 ?? '—'} mem%=${p.memUsedPct ?? '—'} disk%=${p.diskUsedPct ?? '—'} pm2=${p.pm2Online ?? '—'} restarts=${p.pm2RestartTotal ?? '—'}`,
    );
  return `\n## Недавний тренд (${rows.length} точек)\n${rows.join('\n')}`;
}

function renderLogs(snap: ServerSnapshot | null): string {
  if (!snap?.logs) return '';
  const parts: string[] = [];
  const add = (label: string, tail: { available: boolean; lines?: string } | null): void => {
    if (tail?.available && tail.lines) parts.push(`\n### ${label}\n\`\`\`\n${tail.lines}\n\`\`\``);
  };
  add('pm2 stdout', snap.logs.pm2Out);
  add('pm2 stderr', snap.logs.pm2Err);
  add('nginx access', snap.logs.nginxAccess);
  add('nginx error', snap.logs.nginxError);
  return parts.length > 0 ? `\n## Хвосты логов${parts.join('')}` : '';
}

// Собирает markdown-контекст для AI-анализа: сервер + последний снимок + активные алерты +
// тренд (+ логи для logs/alert). Всё пред-загружается в job, диспетчер ничего не до-запрашивает.
export async function prepareMonitoringContext(
  deps: PrepareContextDeps,
  params: { serverId: string; projectId: string; analysisType: MonitoringAnalysisType },
): Promise<string> {
  const server = await deps.servers.getById(params.serverId);
  if (!server) return 'Сервер не найден.';
  const [snap, activeAlerts, trend] = await Promise.all([
    deps.snapshots.getLatest(params.serverId),
    deps.alerts.listActiveByProject(params.projectId),
    deps.snapshots.getHistory(params.serverId, { limit: TREND_POINTS }),
  ]);
  const serverAlerts = activeAlerts.filter((a) => a.serverId === params.serverId);

  const sections = [renderSnapshot(server, snap), renderAlerts(serverAlerts), renderTrend(trend)];
  // Логи объёмны — кладём только когда анализ про логи/алерт.
  if (params.analysisType === 'logs' || params.analysisType === 'alert') {
    sections.push(renderLogs(snap));
  }
  const ctx = sections.filter(Boolean).join('\n');
  return ctx.length > MAX_CONTEXT_CHARS ? ctx.slice(0, MAX_CONTEXT_CHARS) + '\n…(обрезано)' : ctx;
}
