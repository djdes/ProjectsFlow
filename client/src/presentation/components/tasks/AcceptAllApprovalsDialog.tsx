import { useState } from 'react';
import { Check, CheckCheck, Circle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { plainTaskTitle } from '@/lib/taskTitleBody';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';
import { ApprovalSummary } from './ApprovalSummary';
import type { InboxBlockTask } from './inboxBlockTasks';

type AcceptAction = (item: InboxBlockTask) => Promise<void>;

type ItemState = { readonly status: 'waiting' | 'accepting' | 'done' | 'failed'; readonly error?: string };

// «Принять все» в шапке полки «На утверждении»: кнопка и окно со списком задач и их
// ИИ-сводками. Принимает по одной тем же действием, что и кнопка «Принять» на карточке.
export function AcceptAllApprovalsButton({
  items,
  onAccept,
}: {
  items: readonly InboxBlockTask[];
  onAccept: AcceptAction;
}): React.ReactElement {
  const [batch, setBatch] = useState<readonly InboxBlockTask[] | null>(null);
  // Новый ключ на каждое открытие — окно начинает с чистого состояния.
  const [runKey, setRunKey] = useState(0);
  // Кнопка — только когда принимать есть что пачкой (2+). Окно же живёт, пока открыто:
  // по ходу приёмки полка пустеет, и условие на кнопку не должно закрыть его на середине.
  return (
    <>
      {items.length >= 2 && (
        <button
          type="button"
          onClick={() => {
            // Снимок очереди на момент открытия: пока идёт приёмка, полка обновляется сама,
            // и список в окне не должен прыгать под рукой.
            setBatch(items);
            setRunKey((k) => k + 1);
          }}
          title="Принять все задачи на утверждении"
          // На десктопе колонка «Сейчас» узкая (284px): подпись прячем, иначе она съедает
          // название полки. На телефоне полка во всю ширину — подпись видна, кнопка справа.
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-meta font-semibold text-done-ink transition-colors hover:bg-done-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:ms-auto"
        >
          <CheckCheck aria-hidden className="size-3.5" strokeWidth={2.4} />
          <span className="md:sr-only">Принять все</span>
        </button>
      )}
      {batch && (
        <AcceptAllApprovalsDialog key={runKey} items={batch} onAccept={onAccept} onClose={() => setBatch(null)} />
      )}
    </>
  );
}

function AcceptAllApprovalsDialog({
  items,
  onAccept,
  onClose,
}: {
  items: readonly InboxBlockTask[];
  onAccept: AcceptAction;
  onClose: () => void;
}): React.ReactElement {
  const { celebrate } = useCompletedToday();
  const [states, setStates] = useState<Readonly<Record<string, ItemState>>>({});
  const [running, setRunning] = useState(false);
  const total = items.length;
  const finished = items.filter((item) => {
    const status = states[item.id]?.status;
    return status === 'done' || status === 'failed';
  }).length;

  const acceptAll = async (): Promise<void> => {
    setRunning(true);
    const accepted: string[] = [];
    const failed: { title: string; error: string }[] = [];
    // Строго по очереди: сервер и тосты видят ту же последовательность, что и при ручной
    // приёмке, а сбой одной задачи не останавливает остальные.
    for (const item of items) {
      setStates((prev) => ({ ...prev, [item.id]: { status: 'accepting' } }));
      try {
        await onAccept(item);
        accepted.push(item.id);
        setStates((prev) => ({ ...prev, [item.id]: { status: 'done' } }));
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : 'неизвестная ошибка';
        failed.push({ title: titleOf(item), error: message });
        setStates((prev) => ({ ...prev, [item.id]: { status: 'failed', error: message } }));
      }
    }
    // Один праздник на всю пачку: вызовы в одном такте React склеивает в одну анимацию.
    for (const id of accepted) celebrate(id);
    if (failed.length > 0) {
      toast.error(`Не удалось принять ${failed.length} из ${total}`, {
        description: failed.map((f) => `«${f.title}»: ${f.error}`).join('\n'),
        duration: 10_000,
      });
    } else {
      toast.success(`Принято задач: ${accepted.length}`);
    }
    setRunning(false);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Пока идёт приёмка, окно не закрывается: иначе непонятно, что успело принять.
        if (!open && !running) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" hideClose={running}>
        <DialogHeader>
          <DialogTitle>Принять все задачи на утверждении</DialogTitle>
          <DialogDescription>
            Каждая задача уйдёт в «Готово» — так же, как по кнопке «Принять» на карточке.
          </DialogDescription>
        </DialogHeader>

        <ul
          aria-label="Задачи на утверждении"
          className="-mx-1 flex max-h-[min(55dvh,26rem)] flex-col gap-1 overflow-y-auto px-1"
        >
          {items.map((item) => {
            const state = states[item.id];
            return (
              <li key={item.id} data-pf-accept-all-item={item.id} className="flex gap-2 rounded-lg px-2 py-1.5">
                <StatusIcon status={state?.status ?? 'waiting'} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-task font-medium">{titleOf(item)}</span>
                    <span className="max-w-[40%] shrink-0 truncate text-2xs text-muted-foreground">
                      {item.assignee.displayName}
                    </span>
                  </div>
                  {state?.status === 'failed' ? (
                    <p className="text-meta text-destructive">Не удалось: {state.error}</p>
                  ) : (
                    <ApprovalSummary projectId={item.projectId} taskId={item.id} revision={item.updatedAt} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {running && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <Progress value={(finished / Math.max(total, 1)) * 100} indicatorClassName="bg-done" />
            <span className="text-meta text-muted-foreground tabular-nums">
              Принято {finished} из {total}
            </span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Отмена
          </Button>
          <Button variant="accept" onClick={() => void acceptAll()} disabled={running || total === 0} className="gap-1.5">
            {running ? (
              <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />
            ) : (
              <CheckCheck aria-hidden className="size-4" />
            )}
            Принять все ({total})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusIcon({ status }: { status: ItemState['status'] }): React.ReactElement {
  const common = 'mbs-[3px] size-4 shrink-0';
  if (status === 'accepting') return <Loader2 aria-label="Принимаем" className={cn(common, 'text-muted-foreground motion-safe:animate-spin')} />;
  if (status === 'done') return <Check aria-label="Принята" className={cn(common, 'text-done')} strokeWidth={2.6} />;
  if (status === 'failed') return <X aria-label="Не принята" className={cn(common, 'text-destructive')} strokeWidth={2.6} />;
  return <Circle aria-hidden className={cn(common, 'text-muted-foreground/50')} />;
}

function titleOf(item: InboxBlockTask): string {
  return plainTaskTitle(item.description ?? '') || 'Без названия';
}
