import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { getInitials } from '@/presentation/layout/projectIcons';
import type { PendingDelegation } from '@/application/task/TaskDelegationRepository';

type Props = {
  // Колбэк после accept/decline — InboxPage refetch'ит задачи.
  onChanged: () => void;
};

// Блок «Делегировано мне» сверху страницы inbox. Видим только если есть pending.
// Каждая строка — задача с превью + кнопки «Принять» (зелёная) и «Отклонить» (серая).
export function PendingDelegationsBlock({ onChanged }: Props): React.ReactElement | null {
  const { taskDelegationRepository } = useContainer();
  const [items, setItems] = useState<PendingDelegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await taskDelegationRepository.listMyPending();
      setItems(list);
    } catch (e) {
      toast.error(`Не удалось загрузить делегирования: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [taskDelegationRepository]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh().then(() => {
      if (cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handle = async (id: string, action: 'accept' | 'decline'): Promise<void> => {
    setPendingIds((s) => new Set(s).add(id));
    try {
      if (action === 'accept') {
        await taskDelegationRepository.accept(id);
        toast.success('Задача принята');
      } else {
        await taskDelegationRepository.decline(id);
        toast.success('Задача отклонена');
      }
      setItems((prev) => prev.filter((d) => d.id !== id));
      onChanged();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setPendingIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section
      id="pending-delegations"
      className="space-y-2 rounded-lg border border-amber-300/60 bg-amber-50/40 p-3 dark:border-amber-400/30 dark:bg-amber-950/20"
    >
      <h2 className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
        Делегировано мне
        <span className="rounded-full bg-amber-200/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-800/40 dark:text-amber-200">
          {items.length}
        </span>
      </h2>
      <ul className="space-y-1.5">
        {items.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-3 rounded-md border bg-card px-3 py-2"
          >
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="text-[11px]">
                {getInitials(d.creatorDisplayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug">
                <span className="font-medium">{d.creatorDisplayName}</span> делегировал вам:
              </p>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                «{d.taskExcerpt || '(без описания)'}»
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700"
                disabled={pendingIds.has(d.id)}
                onClick={() => void handle(d.id, 'accept')}
              >
                <Check className="size-3.5" />
                Принять
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-muted-foreground"
                disabled={pendingIds.has(d.id)}
                onClick={() => void handle(d.id, 'decline')}
              >
                <X className="size-3.5" />
                Отклонить
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
