import { useState } from 'react';
import { ChevronDown, RefreshCw, Server, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/relativeTime';
import { useContainer } from '@/infrastructure/di/container';
import type { ServerWithLatest } from '@/domain/monitoring/Server';
import { StatusBadge, PmStatusBadge } from './StatusBadge';
import { ResourceBar } from './ResourceBar';
import { LogTailViewer } from './LogTailViewer';
import { fmtBytes, fmtDuration } from './format';

export function ServerCard({
  projectId,
  item,
  canManage,
  onChanged,
}: {
  projectId: string;
  item: ServerWithLatest;
  canManage: boolean;
  onChanged: () => void;
}): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const { server, latest } = item;
  const [busy, setBusy] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const metrics = latest?.metrics ?? null;
  const system = metrics?.system ?? null;

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      await monitoringRepository.triggerCollect(projectId, server.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm(`Удалить сервер «${server.name}» из мониторинга?`)) return;
    setBusy(true);
    try {
      await monitoringRepository.deleteServer(projectId, server.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            <span className="truncate font-semibold">{server.name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {server.kind}
            </span>
            <StatusBadge status={latest?.status ?? server.lastStatus ?? 'unknown'} />
          </div>
          <p className="text-xs text-muted-foreground">
            {latest ? `обновлено ${relativeTime(latest.collectedAt)}` : 'нет данных'}
            {server.host ? ` · ${server.host}` : ''}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            {server.kind === 'local' && (
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
                <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
                Обновить
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => void remove()} disabled={busy} aria-label="Удалить сервер">
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* pm2 */}
        <div>
          <h4 className="mb-2 text-sm font-medium">Процессы pm2</h4>
          {metrics && metrics.pm2.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Процесс</th>
                    <th className="py-1 pr-3 font-medium">Статус</th>
                    <th className="py-1 pr-3 font-medium">Аптайм</th>
                    <th className="py-1 pr-3 font-medium">Рестарты</th>
                    <th className="py-1 pr-3 font-medium">CPU</th>
                    <th className="py-1 font-medium">Память</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.pm2.map((p) => (
                    <tr key={p.name} className="border-t border-border/40">
                      <td className="py-1.5 pr-3 font-medium">{p.name}</td>
                      <td className="py-1.5 pr-3"><PmStatusBadge status={p.status} /></td>
                      <td className="py-1.5 pr-3 tabular-nums">{fmtDuration(p.uptimeMs)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{p.restarts ?? '—'}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{p.cpuPct === null ? '—' : `${p.cpuPct}%`}</td>
                      <td className="py-1.5 tabular-nums">{fmtBytes(p.memoryBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Нет данных pm2.</p>
          )}
        </div>

        {/* система */}
        {system && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <ResourceBar
                label="Память"
                pct={system.memUsedPct}
                sub={`${fmtBytes(system.memUsedBytes)} / ${fmtBytes(system.memTotalBytes)}`}
              />
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Load average</span>
                <span className="font-medium tabular-nums">
                  {system.load1 ?? '—'} / {system.load5 ?? '—'} / {system.load15 ?? '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Аптайм</span>
                <span className="font-medium tabular-nums">
                  {system.uptimeSeconds === null ? '—' : fmtDuration(system.uptimeSeconds * 1000)}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              {system.disks.length > 0 ? (
                system.disks.map((d) => (
                  <ResourceBar key={d.mount} label={`Диск ${d.mount}`} pct={d.usedPct} sub={fmtBytes(d.totalBytes)} />
                ))
              ) : (
                <p className="text-xs text-muted-foreground">Нет данных по дискам.</p>
              )}
            </div>
          </div>
        )}

        {latest?.errors && latest.errors.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Ошибки сбора: {latest.errors.join('; ')}
          </p>
        )}

        {/* логи */}
        <div>
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={showLogs ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'} />
            Логи
          </button>
          {showLogs && (
            <div className="mt-2">
              <LogTailViewer projectId={projectId} serverId={server.id} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
