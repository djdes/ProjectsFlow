import { useState } from 'react';
import { Loader2, Octagon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Task } from '@/domain/task/Task';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  task: Task;
  // Колбэк после успешной request/revoke — родитель refetchнет board (новые поля
  // ralphCancelRequestedAt подтянутся, UI перерисуется в pending / clear состояние).
  onChanged: () => void;
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
export function CancelWorkButton({ task, onChanged }: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [busy, setBusy] = useState(false);

  const pending = task.ralphCancelRequestedAt !== null;

  const handleRequest = async (): Promise<void> => {
    if (busy) return;
    if (
      !window.confirm(
        'Прервать работу Ralph? Локальные изменения worker\'а в репо останутся, ' +
          'но коммит/пуш не пройдёт. Задача вернётся в черновики.',
      )
    )
      return;
    setBusy(true);
    try {
      await taskRepository.requestRalphCancel(task.projectId, task.id);
      toast.success('Отмена запрошена — Ralph обработает её в ближайшие секунды');
      onChanged();
    } catch (e) {
      toast.error(`Не удалось запросить отмену: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await taskRepository.revokeRalphCancel(task.projectId, task.id);
      toast.success('Запрос отозван');
      onChanged();
    } catch (e) {
      toast.error(`Не удалось отозвать: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    const when = task.ralphCancelRequestedAt!;
    const who = task.ralphCancelRequestedByDisplayName;
    return (
      <div className="space-y-2 border-t bg-background/95 px-3 py-3 backdrop-blur-md">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <p className="font-medium">🛑 Отмена запрошена ({formatRelativeMinutes(when)})</p>
          {who && <p className="mt-0.5 opacity-80">{who}</p>}
          <p className="mt-1 text-[11px] opacity-70">
            Ralph дисдетчер обработает в ближайшие ~5 секунд.
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
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
          Отозвать запрос
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t bg-background/95 px-3 py-3 backdrop-blur-md">
      <Button
        type="button"
        variant="destructive"
        className="w-full gap-2"
        onClick={() => void handleRequest()}
        disabled={busy}
        title="Прервать работу Ralph-агента над этой задачей"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Octagon className="size-4" />}
        Отменить работу
      </Button>
    </div>
  );
}
