import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Maximize2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

type Severity = 'error' | 'warn' | 'debug' | 'info';

// Классификация строки лога: уровень (ERROR/WARN/DEBUG) или HTTP-код (5xx/4xx).
function classify(line: string): Severity {
  if (/\b(ERROR|FATAL|PANIC|CRITICAL|EMERG|ALERT)\b/i.test(line) || /\s5\d\d\s/.test(line)) return 'error';
  if (/\b(WARN|WARNING)\b/i.test(line) || /\s4\d\d\s/.test(line)) return 'warn';
  if (/\b(DEBUG|TRACE)\b/i.test(line)) return 'debug';
  return 'info';
}

const SEV_CLS: Record<Severity, string> = {
  error: 'text-red-600 dark:text-red-400',
  warn: 'text-amber-600 dark:text-amber-400',
  debug: 'text-muted-foreground',
  info: '',
};

function LogBody({
  text,
  filter,
  errorsOnly,
  className,
}: {
  text: string;
  filter: string;
  errorsOnly: boolean;
  className?: string;
}): React.ReactElement {
  const lines = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return text.split('\n').filter((l) => {
      if (errorsOnly && classify(l) !== 'error') return false;
      if (f && !l.toLowerCase().includes(f)) return false;
      return true;
    });
  }, [text, filter, errorsOnly]);

  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <pre
      ref={ref}
      className={cn('overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed', className)}
    >
      {lines.length === 0 ? (
        <span className="text-muted-foreground">Нет строк по фильтру</span>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={SEV_CLS[classify(l)]}>
            {l || ' '}
          </div>
        ))
      )}
    </pre>
  );
}

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
  const [filter, setFilter] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

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

  const hasContent = Boolean(log?.available && log.lines);
  const placeholder = loading
    ? 'Загрузка…'
    : (log?.reason && REASON_RU[log.reason]) || 'Нет данных';

  const download = (): void => {
    if (!log?.lines) return;
    const blob = new Blob([log.lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-${serverId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Аналитика nginx access-лога: разбивка по классам HTTP-кодов в текущем хвосте.
  const nginxSummary = useMemo(() => {
    if (kind !== 'nginx_access' || !log?.lines) return null;
    const c = { total: 0, c2: 0, c3: 0, c4: 0, c5: 0 };
    for (const line of log.lines.split('\n')) {
      const m = line.match(/"\s(\d{3})\s/) ?? line.match(/\s([1-5]\d\d)\s/);
      if (!m) continue;
      c.total += 1;
      const d = m[1]![0];
      if (d === '2') c.c2 += 1;
      else if (d === '3') c.c3 += 1;
      else if (d === '4') c.c4 += 1;
      else if (d === '5') c.c5 += 1;
    }
    return c.total > 0 ? c : null;
  }, [kind, log]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => setKind(t.kind)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              kind === t.kind
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="фильтр…"
            className="h-7 w-32 text-xs"
          />
          <button
            type="button"
            onClick={() => setErrorsOnly((v) => !v)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              errorsOnly
                ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                : 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
            title="Только ошибки"
          >
            ошибки
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={download}
            disabled={!hasContent}
            aria-label="Скачать лог"
          >
            <Download className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setFullscreen(true)}
            disabled={!hasContent}
            aria-label="На весь экран"
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {nginxSummary && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-muted-foreground">в хвосте: {nginxSummary.total}</span>
          <span className="text-emerald-600 dark:text-emerald-400">2xx: {nginxSummary.c2}</span>
          <span className="text-sky-600 dark:text-sky-400">3xx: {nginxSummary.c3}</span>
          <span className="text-amber-600 dark:text-amber-400">4xx: {nginxSummary.c4}</span>
          <span className="text-red-600 dark:text-red-400">5xx: {nginxSummary.c5}</span>
        </div>
      )}

      {hasContent ? (
        <LogBody text={log!.lines!} filter={filter} errorsOnly={errorsOnly} className="max-h-72" />
      ) : (
        <pre className="max-h-72 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
          {placeholder}
        </pre>
      )}

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              Логи · {TABS.find((t) => t.kind === kind)?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-1">
            {TABS.map((t) => (
              <button
                key={t.kind}
                type="button"
                onClick={() => setKind(t.kind)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  kind === t.kind
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70',
                )}
              >
                {t.label}
              </button>
            ))}
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="фильтр…"
              className="ml-auto h-7 w-40 text-xs"
            />
          </div>
          {hasContent ? (
            <LogBody
              text={log!.lines!}
              filter={filter}
              errorsOnly={errorsOnly}
              className="max-h-[70vh]"
            />
          ) : (
            <pre className="max-h-[70vh] overflow-auto rounded-md bg-muted/50 p-3 text-xs">
              {placeholder}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
