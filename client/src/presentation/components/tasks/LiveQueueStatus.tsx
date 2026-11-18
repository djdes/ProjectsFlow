import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { dispatcherPulse, type DispatcherHeartbeat } from '@/domain/live/QueueLiveness';
import { RUN_MODE_META, type RunMode, type Task } from '@/domain/task/Task';
import { formatElapsed } from './LivePipeline';
import { RunModeSelect } from './RunMode';

const HEARTBEAT_POLL_MS = 15_000;

function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// Задача в очереди воркера, диспетчер её ещё не забрал. Вместо статичной надписи —
// живое ожидание: сколько ждём, пульс диспетчера (если сервер его знает) и режим
// запуска, который до старта ещё можно поменять.
export function LiveQueueStatus({
  task,
  queuedSince,
  canEdit,
  onTaskChanged,
}: {
  task: Task;
  queuedSince: Date;
  canEdit: boolean;
  onTaskChanged?: (updated: Task) => void;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const now = useNow();
  const [heartbeat, setHeartbeat] = useState<DispatcherHeartbeat | null>(null);
  const [mode, setMode] = useState<RunMode>(task.runMode === 'full' ? 'full' : 'quick');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setMode(task.runMode === 'full' ? 'full' : 'quick'); }, [task.runMode]);

  const { projectId, id: taskId } = task;
  useEffect(() => {
    const load = taskRepository.getDispatcherHeartbeat?.bind(taskRepository);
    if (!load) return;
    let disposed = false;
    const poll = (): void => {
      void load(projectId, taskId).then(next => { if (!disposed) setHeartbeat(next); }).catch(() => { /* нет данных — молчим */ });
    };
    poll();
    const timer = window.setInterval(poll, HEARTBEAT_POLL_MS);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [projectId, taskId, taskRepository]);

  const change = async (next: RunMode): Promise<void> => {
    if (next === mode || saving) return;
    const prev = mode;
    setMode(next);
    setSaving(true);
    try {
      const updated = await taskRepository.update(projectId, taskId, { runMode: next });
      onTaskChanged?.(updated);
    } catch (err) {
      setMode(prev);
      toast.error(`Не удалось сменить режим запуска: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // Без валидной метки (старые данные) считаем от открытия вкладки — время всё равно идёт.
  const [mountedAt] = useState(() => Date.now());
  const sinceMs = queuedSince instanceof Date && Number.isFinite(queuedSince.getTime()) ? queuedSince.getTime() : mountedAt;
  const waited = Math.max(0, (now.getTime() - sinceMs) / 1000);
  const pulse = dispatcherPulse(heartbeat, now);
  return (
    <div role="status" data-pf-live-queue="" className="space-y-1.5 rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-sm text-primary-ink">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
        </span>
        <span className="min-w-0 flex-1">Задача в очереди — ожидает запуска диспетчера</span>
        <span className="shrink-0 tabular-nums text-xs opacity-80" data-pf-live-queue-elapsed="">{formatElapsed(waited)}</span>
      </div>
      {pulse.kind === 'seen' && (
        <p className="text-xs opacity-80" data-pf-dispatcher-pulse="seen">Диспетчер на связи ({formatElapsed(pulse.secondsAgo)} назад)</p>
      )}
      {pulse.kind === 'offline' && (
        <p className="flex items-start gap-1.5 text-xs text-destructive" data-pf-dispatcher-pulse="offline">
          <AlertTriangle className="mbs-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {pulse.secondsAgo === null ? 'Диспетчер не выходил на связь' : `Диспетчер не выходил на связь ${formatElapsed(pulse.secondsAgo)}`}
            {' '}— похоже, он офлайн. Задача начнётся, когда он вернётся.
          </span>
        </p>
      )}
      {pulse.kind === 'unassigned' && (
        <p className="flex items-start gap-1.5 text-xs text-destructive" data-pf-dispatcher-pulse="unassigned">
          <AlertTriangle className="mbs-0.5 size-3.5 shrink-0" aria-hidden />
          <span>У проекта не назначен диспетчер — задачу некому забрать.</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-pf-live-run-mode={mode}>
        <span className="opacity-80">Режим запуска:</span>
        {canEdit ? (
          <div className="min-w-[12rem]"><RunModeSelect value={mode} onChange={(v) => void change(v)} disabled={saving} variant="ghost" className="h-7 px-2 text-xs" /></div>
        ) : (
          <span className="font-medium">{RUN_MODE_META[mode].label}</span>
        )}
      </div>
    </div>
  );
}

// Воркер уже работает: режим только показываем — смена подействует со следующего запуска.
export function LiveRunModeNote({ task }: { task: Task }): React.ReactElement {
  const mode: RunMode = task.runMode === 'full' ? 'full' : 'quick';
  return (
    <p className="px-1 text-2xs text-muted-foreground" data-pf-live-run-mode={mode} data-pf-live-run-mode-locked="">
      Режим запуска: <span className="font-medium text-foreground">{RUN_MODE_META[mode].label}</span> · смена режима применится к следующему запуску
    </p>
  );
}
