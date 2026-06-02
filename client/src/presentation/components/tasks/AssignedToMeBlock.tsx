import { useCallback, useEffect, useState } from 'react';
import { Check, FolderKanban, GitCommit, ImageIcon, Inbox as InboxIcon, MessageSquare, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { getInitials } from '@/presentation/layout/projectIcons';
import { relativeTime } from '@/lib/relativeTime';
import type { Task, RalphMode, TaskPriority } from '@/domain/task/Task';
import type { AssignedGroup, AssignedTask } from '@/domain/task/AssignedTask';
import { InboxCheckbox } from './InboxCheckbox';
import { DelegationBadge } from './DelegationBadge';
import { PriorityBadge } from './PriorityBadge';
import { DeadlineBadge } from './DeadlineBadge';
import { RalphModeBadge } from './RalphMode';
import { TaskDrawer, type TaskDrawerState } from './TaskDrawer';

type Props = {
  // Колбэк после accept/decline/toggle — InboxPage перефетчит доску ниже (принятые
  // задачи мёрджатся в inbox-список).
  onChanged?: () => void;
};

// Блок «Поручено мне» на главной: задачи, делегированные текущему пользователю, по всем
// проектам, сгруппированные по проекту. Принятые — с чекбоксом «выполнено» (снятие
// галочки возвращает прежний статус); ожидающие — с кнопками «Принять/Отклонить».
// Заменяет прежний жёлтый блок PendingDelegationsBlock. Клик по принятой задаче открывает
// её в TaskDrawer (read-access для inbox-делегата гейтится на сервере).
export function AssignedToMeBlock({ onChanged }: Props): React.ReactElement | null {
  const { taskDelegationRepository, taskRepository } = useContainer();
  const { user } = useCurrentUser();
  const [groups, setGroups] = useState<AssignedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const [drawerTask, setDrawerTask] = useState<AssignedTask | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await taskDelegationRepository.listAssignedToMe();
      setGroups(list);
    } catch (e) {
      toast.error(`Не удалось загрузить поручения: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [taskDelegationRepository]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    // Перефетч при возврате на вкладку — ловим новые поручения без ручного refresh.
    const onFocus = (): void => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const resolve = async (delegationId: string, action: 'accept' | 'decline'): Promise<void> => {
    setResolvingIds((s) => new Set(s).add(delegationId));
    try {
      if (action === 'accept') {
        await taskDelegationRepository.accept(delegationId);
        toast.success('Задача принята');
      } else {
        await taskDelegationRepository.decline(delegationId);
        toast.success('Задача отклонена');
      }
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setResolvingIds((s) => {
        const n = new Set(s);
        n.delete(delegationId);
        return n;
      });
    }
  };

  const handleToggled = (): void => {
    void refresh();
    onChanged?.();
  };

  const handleDrawerSubmit = async (input: {
    description: string;
    ralphMode?: RalphMode;
    deadline?: string | null;
    priority?: TaskPriority | null;
  }): Promise<Task> => {
    if (!drawerTask) throw new Error('Нет открытой задачи');
    return taskRepository.update(drawerTask.projectId, drawerTask.id, {
      description: input.description,
      ralphMode: input.ralphMode,
    });
  };

  if (loading) return null;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return null;

  return (
    <section
      id="assigned-to-me"
      className="space-y-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-3 dark:border-primary/25 dark:bg-primary/[0.06]"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        Поручено мне
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
          {total}
        </span>
      </h2>

      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.projectId} className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-0.5 text-xs font-medium text-muted-foreground">
              {group.isInbox ? (
                <InboxIcon className="size-3.5 shrink-0" />
              ) : (
                <FolderKanban className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{group.label}</span>
              <span className="text-muted-foreground/60">· {group.items.length}</span>
            </div>
            <ul className="divide-y overflow-hidden rounded-md border bg-card">
              {[...group.items]
                // Ожидающие — наверх (требуют действия), принятые — ниже.
                .sort((a, b) => Number(b.delegation.status === 'pending') - Number(a.delegation.status === 'pending'))
                .map((item) =>
                  item.delegation.status === 'pending' ? (
                    <PendingRow
                      key={item.delegation.id}
                      item={item}
                      busy={resolvingIds.has(item.delegation.id)}
                      onAccept={() => void resolve(item.delegation.id, 'accept')}
                      onDecline={() => void resolve(item.delegation.id, 'decline')}
                    />
                  ) : (
                    <AcceptedRow
                      key={item.delegation.id}
                      item={item}
                      currentUserId={user?.id ?? null}
                      onOpen={() => setDrawerTask(item)}
                      onChanged={handleToggled}
                    />
                  ),
                )}
            </ul>
          </div>
        ))}
      </div>

      <TaskDrawer
        state={drawerTask ? ({ mode: 'edit', task: drawerTask } as TaskDrawerState) : null}
        onClose={() => {
          setDrawerTask(null);
          void refresh();
        }}
        onSubmit={handleDrawerSubmit}
        onCommitsChange={() => void refresh()}
        showCommits={drawerTask ? !drawerTask.isInbox : false}
        projectName={drawerTask && !drawerTask.isInbox ? drawerTask.projectName : undefined}
        isInbox={drawerTask?.isInbox ?? false}
        aiProjectId={drawerTask && !drawerTask.isInbox ? drawerTask.projectId : null}
      />
    </section>
  );
}

// Принятая задача — ведёт себя как обычная строка: чекбокс «выполнено» (снятие
// восстанавливает прежний статус), клик открывает drawer.
function AcceptedRow({
  item,
  currentUserId,
  onOpen,
  onChanged,
}: {
  item: AssignedTask;
  currentUserId: string | null;
  onOpen: () => void;
  onChanged: () => void;
}): React.ReactElement {
  const isDone = item.status === 'done';
  return (
    <li
      className="group flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
      onClick={onOpen}
    >
      <InboxCheckbox
        task={item}
        lastDoneTaskId={null}
        lastTodoTaskId={null}
        onChanged={onChanged}
        disabled={!item.canModify}
        disabledTitle="Вы больше не редактор этого проекта"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'line-clamp-2 whitespace-pre-wrap text-sm leading-snug',
            isDone && 'text-muted-foreground line-through decoration-muted-foreground/40',
          )}
        >
          {item.description ?? '—'}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          {currentUserId && (
            <DelegationBadge delegation={item.delegation} currentUserId={currentUserId} />
          )}
          {(item.commitCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
              <GitCommit className="size-2.5" />
              {item.commitCount}
            </span>
          )}
          {(item.attachmentCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400">
              <ImageIcon className="size-2.5" />
              {item.attachmentCount}
            </span>
          )}
          {(item.commentCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400">
              <MessageSquare className="size-2.5" />
              {item.commentCount}
            </span>
          )}
          <RalphModeBadge mode={item.ralphMode} />
          {item.priority !== null && item.priority !== undefined && (
            <PriorityBadge priority={item.priority} />
          )}
          {item.deadline && <DeadlineBadge deadline={item.deadline} status={item.status} />}
          <span className="opacity-60" title={item.createdAt.toLocaleString('ru-RU')}>
            {relativeTime(item.createdAt)}
          </span>
        </div>
      </div>
    </li>
  );
}

// Ожидающая задача — не открывается; кнопки «Принять/Отклонить».
function PendingRow({
  item,
  busy,
  onAccept,
  onDecline,
}: {
  item: AssignedTask;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}): React.ReactElement {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="text-[11px]">
          {getInitials(item.delegation.creatorDisplayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-medium">{item.delegation.creatorDisplayName}</span> поручил вам:
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          «{item.description || '(без описания)'}»
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button
          size="sm"
          className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700"
          disabled={busy}
          onClick={onAccept}
        >
          <Check className="size-3.5" />
          Принять
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-muted-foreground"
          disabled={busy}
          onClick={onDecline}
        >
          <X className="size-3.5" />
          Отклонить
        </Button>
      </div>
    </li>
  );
}
