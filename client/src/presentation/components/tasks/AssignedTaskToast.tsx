import { useState } from 'react';
import { Inbox as InboxIcon, Loader2, PlayCircle } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';

export type AssignedTaskToastData = {
  readonly taskId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly taskExcerpt: string;
  readonly actorDisplayName: string;
};

// Плашка «вам назначили задачу». Не обычный toast-строкой: человеку нужно не только
// узнать, но и сразу что-то сделать — открыть во «Входящих» или взять в работу, не
// прерываясь на поиск задачи. Поэтому toast.custom с двумя действиями.
function AssignedTaskToastCard({
  data,
  toastId,
}: {
  data: AssignedTaskToastData;
  toastId: string | number;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const [taking, setTaking] = useState(false);

  // «Взять в работу» = статус manual, тот же, что у полки «В работе»: агент такие задачи
  // не подхватывает, и это честное «делаю руками».
  const takeToWork = async (): Promise<void> => {
    if (taking) return;
    setTaking(true);
    try {
      await taskRepository.move(data.projectId, data.taskId, {
        targetStatus: 'manual',
        beforeTaskId: null,
        afterTaskId: null,
      });
      toast.dismiss(toastId);
      toast.success('Задача у вас в работе');
      window.dispatchEvent(new CustomEvent('pf:task-changed', { detail: { projectId: data.projectId } }));
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setTaking(false);
    }
  };

  const openInInbox = (): void => {
    toast.dismiss(toastId);
    // Полная навигация, а не router.push: тост живёт вне роутера (портал sonner), и
    // тащить сюда navigate значило бы тянуть роутер в компонент уведомления.
    window.location.assign(`/inbox?task=${encodeURIComponent(data.taskId)}`);
  };

  const excerpt = data.taskExcerpt.trim();
  return (
    <div className="flex w-[min(22rem,90vw)] flex-col gap-2 rounded-xl border border-primary/30 bg-card p-3 shadow-lg">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <InboxIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {data.actorDisplayName} назначил вам задачу · {data.projectName}
          </p>
          {excerpt.length > 0 && (
            <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug">{excerpt}</p>
          )}
        </div>
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={openInInbox}
          className="flex-1 rounded-md bg-muted px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
        >
          Открыть
        </button>
        <button
          type="button"
          onClick={() => void takeToWork()}
          disabled={taking}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {taking ? <Loader2 className="size-3 animate-spin" /> : <PlayCircle className="size-3" />}
          Взять в работу
        </button>
      </div>
    </div>
  );
}

// Держится дольше обычного тоста: сообщение требует решения, а не просто прочтения.
const DURATION_MS = 15_000;

export function showAssignedTaskToast(data: AssignedTaskToastData): void {
  toast.custom((id) => <AssignedTaskToastCard data={data} toastId={id} />, {
    duration: DURATION_MS,
  });
}
