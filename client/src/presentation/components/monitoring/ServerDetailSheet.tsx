import { useEffect, useState } from 'react';
import { Bell, BellOff, Pencil, RefreshCw, Server, Sparkles, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/relativeTime';
import { useContainer } from '@/infrastructure/di/container';
import type { ServerWithLatest } from '@/domain/monitoring/Server';
import type { ServerAlert } from '@/domain/monitoring/Alert';
import { StatusBadge } from './StatusBadge';
import { ResourceBar } from './ResourceBar';
import { Pm2Table } from './Pm2Table';
import { Pm2List } from './Pm2List';
import { StatusTimeline } from './StatusTimeline';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { SystemGrid } from './SystemGrid';
import { DbHealthCard } from './DbHealthCard';
import { LogTailViewer } from './LogTailViewer';
import { ServerTrends } from './ServerTrends';
import { AlertList } from './AlertList';
import { AnalyzeServerPanel } from './AnalyzeServerPanel';
import { AddServerDialog } from './AddServerDialog';
import { fmtDuration } from './format';
import { sslTone, toneChipClass } from './health';

// Подробный вид сервера: правый Sheet с вкладками. Один на странице, управляется openId
// в MonitoringPage. Сюда переехало управление сервером (обновить/правка/mute/удалить).
export function ServerDetailSheet({
  projectId,
  item,
  alerts,
  open,
  onOpenChange,
  canManage,
  onChanged,
}: {
  projectId: string;
  item: ServerWithLatest | null;
  alerts: ServerAlert[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onChanged: () => void;
}): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const server = item?.server ?? null;
  const latest = item?.latest ?? null;
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  // На мобиле детали открываем снизу (bottom-sheet), на десктопе — справа.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  // «Сейчас» для StatusTimeline — фиксируем в эффекте (Date.now() в render нельзя — purity).
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setIsMuted(server?.mutedUntil != null && server.mutedUntil.getTime() > Date.now());
  }, [server?.mutedUntil]);

  useEffect(() => {
    if (open) setNowMs(Date.now());
  }, [open, latest?.collectedAt]);

  const refresh = async (): Promise<void> => {
    if (!server) return;
    setBusy(true);
    try {
      await monitoringRepository.triggerCollect(projectId, server.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!server) return;
    if (!window.confirm(`Удалить сервер «${server.name}» из мониторинга?`)) return;
    setBusy(true);
    try {
      await monitoringRepository.deleteServer(projectId, server.id);
      onOpenChange(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = async (): Promise<void> => {
    if (!server) return;
    setBusy(true);
    try {
      await monitoringRepository.muteServer(projectId, server.id, isMuted ? null : 60);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const metrics = latest?.metrics ?? null;
  const system = metrics?.system ?? null;
  const http = metrics?.http ?? null;
  const ssl = metrics?.ssl ?? null;
  const worstDisk = system && system.disks.length > 0 ? Math.max(...system.disks.map((d) => d.usedPct)) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {server && (
        <SheetContent
          side={isDesktop ? 'right' : 'bottom'}
          className={cn(
            'flex flex-col gap-0 p-0',
            isDesktop ? 'w-full sm:max-w-2xl lg:max-w-3xl' : 'h-[88vh]',
          )}
        >
          <SheetHeader className="space-y-2 border-b p-4 text-left">
            <div className="flex items-center gap-2 pr-8">
              <Server className="size-4 shrink-0 text-muted-foreground" />
              <SheetTitle className="truncate text-base">{server.name}</SheetTitle>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {server.kind}
              </span>
              <StatusBadge status={latest?.status ?? server.lastStatus ?? 'unknown'} />
            </div>
            <SheetDescription className="text-xs">
              {latest ? `обновлено ${relativeTime(latest.collectedAt)}` : 'нет данных'}
              {server.host ? ` · ${server.host}` : ''}
              {isMuted && server.mutedUntil && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">
                  · 🔕 тихо до{' '}
                  {server.mutedUntil.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </SheetDescription>
            {canManage && (
              <div className="flex flex-wrap items-center gap-1 pt-1">
                {server.kind === 'local' && (
                  <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
                    <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
                    Обновить
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)} disabled={busy}>
                  <Pencil className="size-4" />
                  Правка
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void toggleMute()} disabled={busy}>
                  {isMuted ? <BellOff className="size-4 text-amber-500" /> : <Bell className="size-4" />}
                  {isMuted ? 'Включить' : 'Заглушить'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="size-4" />
                  Удалить
                </Button>
              </div>
            )}
          </SheetHeader>

          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-4 mt-3 flex h-auto w-auto flex-wrap justify-start gap-1 self-start">
              <TabsTrigger value="overview">Обзор</TabsTrigger>
              <TabsTrigger value="processes">Процессы</TabsTrigger>
              <TabsTrigger value="metrics">Метрики</TabsTrigger>
              <TabsTrigger value="logs">Логи</TabsTrigger>
              <TabsTrigger value="trends">Тренды</TabsTrigger>
              <TabsTrigger value="ai">
                <Sparkles className="size-3.5" />
                AI
              </TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <TabsContent value="overview" className="mt-0 space-y-4">
                <StatusTimeline projectId={projectId} serverId={server.id} nowMs={nowMs} />
                {(http || (ssl && ssl.daysLeft !== null)) && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {http && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium',
                          toneChipClass(http.ok ? 'ok' : 'crit'),
                        )}
                      >
                        HTTP {http.statusCode ?? http.error ?? '—'}
                        {http.latencyMs !== null ? ` · ${http.latencyMs}мс` : ''}
                      </span>
                    )}
                    {ssl && ssl.daysLeft !== null && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium',
                          toneChipClass(sslTone(ssl.daysLeft)),
                        )}
                      >
                        SSL {ssl.daysLeft} дн
                      </span>
                    )}
                  </div>
                )}

                {system ? (
                  <div className="space-y-2">
                    {typeof system.cpuUsedPct === 'number' && <ResourceBar label="CPU" pct={system.cpuUsedPct} />}
                    <ResourceBar label="Память" pct={system.memUsedPct} />
                    {worstDisk !== null && <ResourceBar label="Диск (макс.)" pct={worstDisk} />}
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Load · аптайм</span>
                      <span className="font-medium tabular-nums">
                        {system.load1 ?? '—'} ·{' '}
                        {system.uptimeSeconds === null ? '—' : fmtDuration(system.uptimeSeconds * 1000)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Нет системных метрик.</p>
                )}

                <div>
                  <h4 className="mb-2 text-sm font-medium">Активные алерты</h4>
                  <AlertList alerts={alerts} />
                </div>

                {latest?.errors && latest.errors.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Ошибки сбора: {latest.errors.join('; ')}
                  </p>
                )}
              </TabsContent>

              <TabsContent value="processes" className="mt-0">
                <div className="hidden md:block">
                  <Pm2Table pm2={metrics?.pm2 ?? []} />
                </div>
                <div className="md:hidden">
                  <Pm2List pm2={metrics?.pm2 ?? []} />
                </div>
              </TabsContent>

              <TabsContent value="metrics" className="mt-0 space-y-4">
                {system ? <SystemGrid system={system} /> : <p className="text-sm text-muted-foreground">Нет данных.</p>}
                {latest?.dbHealth?.reachable && <DbHealthCard db={latest.dbHealth} />}
              </TabsContent>

              <TabsContent value="logs" className="mt-0">
                <LogTailViewer projectId={projectId} serverId={server.id} />
              </TabsContent>

              <TabsContent value="trends" className="mt-0">
                <ServerTrends projectId={projectId} serverId={server.id} />
              </TabsContent>

              <TabsContent value="ai" className="mt-0">
                <AnalyzeServerPanel projectId={projectId} serverId={server.id} canManage={canManage} />
              </TabsContent>
            </div>
          </Tabs>
        </SheetContent>
      )}

      {canManage && server && (
        <AddServerDialog
          projectId={projectId}
          open={showSettings}
          onOpenChange={setShowSettings}
          onSaved={onChanged}
          editServer={server}
        />
      )}
    </Sheet>
  );
}
