import { useState } from 'react';
import { Loader2, Octagon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Task } from '@/domain/task/Task';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  task: Task;
  // Notify the parent to refresh other views after applying the server response.
  onChanged: (task: Task) => void;
  workerRunning?: boolean;
};

const TIME_FMT = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

function formatRelativeMinutes(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin === 0) return 'только что';
  if (diffMin === 1) return '1 минута назад';
  if (diffMin < 5) return `${diffMin} минуты назад`;
  if (diffMin < 60) return `${diffMin} минут назад`;
  // > 1 ч — показываем абсолютное время. Cancel pending >1ч обычно означает что
  // Ralph offline; юзеру полезно видеть конкретное время.
  return `с ${TIME_FMT.format(date)}`;
}

// Кнопка отмены Ralph-работы для in_progress / awaiting_clarification задач.
// Два состояния:
//   1. Нет запроса (task.ralphCancelRequestedAt === null) → красная кнопка
//      «🛑 Отменить работу». Клик → confirm → POST /ralph-cancel.
//   2. Запрос висит — амбер-badge «🛑 Отмена запрошена…» + кнопка «Отозвать».
//      DELETE /ralph-cancel.
// SSE task_changed обновит board ⇒ refetch ⇒ pending переключение в реалтайме.
export function CancelWorkButton({ task: sourceTask, onChanged, workerRunning = false }: Props): React.ReactElement | null {
  const { taskRepository } = useContainer();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ taskId: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ source: Task; task: Task } | null>(null);
  // Some drawers keep their original task until reopened. Apply the acknowledged
  // response immediately; a refreshed parent task (including SSE ack) takes over.
  const task = result?.source === sourceTask ? result.task : sourceTask;

  const pending = task.ralphCancelRequestedAt !== null;

  const handleRequest = async (): Promise<void> => {
    if (busy) return;
    if (
      !window.confirm(
        'Отправить запрос на остановку воркера? Диспетчер подтвердит остановку. ' +
          'Локальные изменения и уже опубликованные коммиты сохранятся.',
      )
    )
      return;
    setBusy(true);
    setError('');
    setFeedback(null);
    try {
      const updated = await taskRepository.requestRalphCancel(task.projectId, task.id);
      setResult({ source: sourceTask, task: updated });
      toast.success('Запрос на остановку отправлен. Ожидаем подтверждения диспетчера.');
      onChanged(updated);
    } catch (e) {
      const message = `Не удалось запросить отмену: ${(e as Error).message}`;
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await taskRepository.revokeRalphCancel(task.projectId, task.id);
      setResult({ source: sourceTask, task: updated });
      const text = workerRunning || ['in_progress', 'awaiting_clarification'].includes(updated.status)
        ? 'Запрос на отмену отозван. Остановка больше не запрашивается.'
        : 'Запрос на отмену снят. Работа уже остановлена или завершена.';
      setFeedback({ taskId: task.id, text });
      toast.success(text);
      onChanged(updated);
    } catch (e) {
      const message = `Не удалось отозвать запрос: ${(e as Error).message}`;
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  if (sourceTask.canEdit === false) return null;
  if (pending) {
    const when = task.ralphCancelRequestedAt!;
    const who = task.ralphCancelRequestedByDisplayName;
    return (
      <div className="space-y-2 border-bs bg-background/95 px-3 py-3 backdrop-blur-md">
        <div className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-ink">
          <p className="font-medium">🛑 Отмена запрошена ({formatRelativeMinutes(when)})</p>
          {who && <p className="mbs-0.5 opacity-80">{who}</p>}
          <p className="mbs-1 text-2xs opacity-70">
            Остановка ещё не подтверждена. Диспетчер обработает запрос, когда будет на связи.
            Отзыв отмены разрешит продолжить работу.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => void handleRevoke()}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : <X className="size-3.5" />}
          {busy ? 'Отзываем запрос на отмену…' : 'Отозвать запрос на отмену'}
        </Button>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border-bs bg-background/95 px-3 py-3 backdrop-blur-md">
      {feedback?.taskId === task.id && <p role="status" className="mbe-2 rounded-md bg-done-soft px-3 py-2 text-xs text-done-ink">{feedback.text}</p>}
      {error && <p role="alert" className="mbe-2 text-xs text-destructive">{error}</p>}
      {(workerRunning || ['in_progress', 'awaiting_clarification'].includes(task.status)) && (
      <Button
        type="button"
        variant="destructive"
        className="w-full gap-2"
        onClick={() => void handleRequest()}
        disabled={busy}
        title="Прервать работу Ralph-агента над этой задачей"
      >
        {busy ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Octagon className="size-4" />}
        {busy ? 'Отправляем запрос на остановку…' : 'Отменить работу'}
      </Button>
      )}
    </div>
  );
}
