import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useWorkerEnabled } from '@/presentation/hooks/useWorkerEnabled';
import type { RunMode, Task, TaskStatus } from '@/domain/task/Task';
import { RunModeSelect } from './RunMode';

// awaiting_clarification — запарковано/упало без живого воркера: можно «Запустить снова».
const LAUNCHABLE: readonly string[] = ['backlog', 'manual', 'todo', 'awaiting_clarification', 'custom_1', 'custom_2', 'custom_3', 'custom_4', 'custom_5'];
// После постановки в очередь диспетчер мог уже успеть забрать задачу — это тоже успех.
const ACCEPTED: readonly TaskStatus[] = ['todo', 'in_progress', 'awaiting_clarification'];

// «В очереди» определяется ТОЛЬКО серверным статусом задачи (todo). Никакого локального
// «queued»-флага: раньше он переживал отмену запуска, и кнопка навсегда оставалась
// «Задача в очереди» (disabled) — повторный запуск не доходил до сервера.
export function RunWithWorkerButton({ task, onChanged, onQueued, relaunch = false }: { task: Task; onChanged?: () => void; onQueued?: (updated: Task) => void; relaunch?: boolean }): React.ReactElement | null {
  const { taskRepository } = useContainer();
  const enabled = useWorkerEnabled();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Режим запуска выбирает человек на каждой задаче (spec 2026-11-17 §5); дефолт — режим задачи.
  const [runMode, setRunMode] = useState<RunMode>(task.runMode === 'full' ? 'full' : 'quick');
  const sending = useRef(false);
  if (!enabled || task.canEdit === false || !LAUNCHABLE.includes(task.status)) return null;
  const waiting = task.status === 'todo';
  const run = async (): Promise<void> => {
    if (sending.current || waiting) return;
    sending.current = true; setBusy(true); setError('');
    try {
      // Режим сохраняем ДО постановки в очередь: диспетчер читает его из задачи.
      if (runMode !== (task.runMode === 'full' ? 'full' : 'quick')) await taskRepository.update(task.projectId, task.id, { runMode });
      const moved = await taskRepository.move(task.projectId, task.id, { targetStatus: 'todo', beforeTaskId: null, afterTaskId: null });
      if (!ACCEPTED.includes(moved.status)) throw new Error(`сервер не поставил задачу в очередь (статус «${moved.status}»)`);
      // Сверяемся с сервером повторным чтением: показываем «в очереди», только если задача там и правда стоит.
      const fresh = await taskRepository.get(task.projectId, task.id);
      if (!ACCEPTED.includes(fresh.status)) throw new Error(`задача не осталась в очереди (статус «${fresh.status}»)`);
      onQueued?.(fresh);
      onChanged?.();
    } catch (e) {
      const message = `Не удалось отправить задачу воркеру: ${e instanceof Error ? e.message : String(e)}`;
      setError(message);
      toast.error(message);
      onChanged?.();
    } finally {
      sending.current = false; setBusy(false);
    }
  };
  return (
    <div data-pf-worker-start="" className="mx-3 mbs-3 mbe-2 space-y-2">
      {!waiting && <p className="text-xs text-muted-foreground">{relaunch ? 'Прошлый запуск не довёл задачу до конца — можно запустить воркер снова.' : 'Передай задачу воркеру — ход выполнения появится в LIVE.'}</p>}
      {!waiting && <div className="max-w-xs"><RunModeSelect value={runMode} onChange={setRunMode} disabled={busy} /></div>}
      <Button type="button" disabled={busy || waiting} onClick={() => void run()}>{waiting ? 'Задача в очереди' : busy ? 'Отправляем…' : relaunch ? 'Запустить снова' : 'Сделать с помощью воркера'}</Button>
      {error && <p role="alert" className="max-w-xs text-xs text-destructive">{error}</p>}
    </div>
  );
}
