import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { META_CHIP_CLASS } from './MetaChip';
import type { SharedMember } from '@/application/project/ProjectRepository';
import type { Task } from '@/domain/task/Task';

type Props = {
  task: Task;
  currentUserId: string | null;
  // Колбэк после delegate/withdraw — родитель refetch'ит данные.
  onChanged: () => void;
  // Если передан — грузим участников конкретного проекта (listMembers) вместо
  // глобального listSharedMembers. Для совместных (не inbox) проектов.
  projectId?: string;
  // Доп. классы на кнопку — для выравнивания значения в ряду свойств (PROPERTY_VALUE_CLASS).
  className?: string;
};

// Кнопка делегирования для существующей inbox-задачи. Три состояния:
//  - нет активной делегации + caller=creator → dropdown с DelegateSelect.
//  - pending + caller=creator → кнопка «Отозвать» (withdraw).
//  - accepted ИЛИ caller≠creator → не рендерим (DelegationBadge сам покажет статус).
export function DelegateTaskButton({ task, currentUserId, onChanged, projectId, className }: Props): React.ReactElement | null {
  const { projectRepository, taskRepository, taskDelegationRepository } = useContainer();
  const [members, setMembers] = useState<SharedMember[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Подгружаем members только если мы — creator и есть смысл показывать dropdown.
  const isCreator = currentUserId !== null && task.delegation
    ? task.delegation.creatorUserId === currentUserId
    : true; // без delegation: caller — owner inbox (= creator), потому что иначе он бы не видел задачу

  const noActiveDelegation = !task.delegation;
  const isPendingByMe = task.delegation?.status === 'pending' && isCreator;

  useEffect(() => {
    if (!noActiveDelegation) return;
    let cancelled = false;
    const loadMembers = projectId
      ? projectRepository.listMembers(projectId).then((list) =>
          list
            .filter((m) => m.userId !== currentUserId)
            .map((m) => ({ id: m.userId, displayName: m.user.displayName, email: m.user.email })),
        )
      : projectRepository.listSharedMembers();
    loadMembers
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, noActiveDelegation, projectId, currentUserId]);

  if (!isCreator) return null;

  const handleDelegate = async (delegateUserId: string): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await taskRepository.delegate(task.projectId, task.id, delegateUserId);
      toast.success('Задача делегирована');
      onChanged();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (): Promise<void> => {
    if (!task.delegation || submitting) return;
    if (!window.confirm('Отозвать делегирование?')) return;
    setSubmitting(true);
    try {
      await taskDelegationRepository.withdraw(task.delegation.id);
      toast.success('Делегирование отозвано');
      onChanged();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (isPendingByMe) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={submitting}
        className={cn(META_CHIP_CLASS, 'hover:text-destructive', className)}
        onClick={() => void handleWithdraw()}
        title="Отозвать делегирование (пока делегат не ответил)"
      >
        {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
        Отозвать
      </Button>
    );
  }

  if (!noActiveDelegation) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          className={cn(META_CHIP_CLASS, className)}
          title="Назначить ответственного — делегировать участнику проекта"
        >
          {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
          ответственный
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        {(members ?? []).length > 0 ? (
          <>
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Выберите участника
            </div>
            <DropdownMenuSeparator />
            {(members ?? []).map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => void handleDelegate(m.id)}
                className="gap-2"
              >
                <span>{m.displayName}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{m.email}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Нет общих участников.<br />
            Пригласите кого-то в проект — потом сможете делегировать.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
