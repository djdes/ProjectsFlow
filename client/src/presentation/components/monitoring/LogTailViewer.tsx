import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import type { LogKind, LogTail } from '@/domain/monitoring/Snapshot';

const TABS: { kind: LogKind; label: string }[] = [
  { kind: 'pm2_out', label: 'pm2 out' },
  { kind: 'pm2_err', label: 'pm2 err' },
  { kind: 'nginx_access', label: 'nginx access' },
  { kind: 'nginx_error', label: 'nginx error' },
];

const REASON_RU: Record<string, string> = {
  no_path: 'Путь к логу не задан',
  not_found: 'Файл лога не найден',
  forbidden: 'Нет доступа к файлу лога (права пользователя pm2)',
  empty: 'Лог пуст',
  error: 'Ошибка чтения лога',
};

export function LogTailViewer({
  projectId,
  serverId,
}: {
  projectId: string;
  serverId: string;
}): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const [kind, setKind] = useState<LogKind>('pm2_out');
  const [log, setLog] = useState<LogTail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    monitoringRepository
      .getLogs(projectId, serverId, kind)
      .then((l) => {
        if (!cancelled) setLog(l);
      })
      .catch(() => {
        if (!cancelled) setLog(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [monitoringRepository, projectId, serverId, kind]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => setKind(t.kind)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              kind === t.kind ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
        {loading
          ? 'Загрузка…'
          : log?.available && log.lines
            ? log.lines
            : (log?.reason && REASON_RU[log.reason]) || 'Нет данных'}
      </pre>
    </div>
  );
}
