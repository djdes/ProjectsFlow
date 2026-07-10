import { useEffect, useState } from 'react';
import { ChevronDown, Check, Loader2, ArrowRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
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
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { META_CHIP_CLASS } from './MetaChip';
import type { SharedMember } from '@/application/project/ProjectRepository';
import type { Task } from '@/domain/task/Task';

type Props = {
  task: Task;
  currentUserId: string | null;
  // Колбэк после смены ответственного — родитель refetch'ит данные.
  onChanged: () => void;
  // Если передан — грузим участников этого проекта (listMembers). Иначе (inbox) —
  // глобальный listSharedMembers.
  projectId?: string;
  // Доп. классы на кнопку — для выравнивания значения в ряду свойств (PROPERTY_VALUE_CLASS).
  className?: string;
};

// Селектор ОТВЕТСТВЕННОГО за задачу. Показывается всегда (даже когда в проекте нет других
// участников — тогда доступен только «Я»). Текущий ответственный = делегат активной делегации,
// либо «Я» (создатель), если делегации нет. Выбор:
//  - «Я» → забрать задачу себе (закрыть активную делегацию, reclaim). Если уже я — no-op.
//  - участник → делегировать (нет делегации) или переназначить (есть активная).
// Модель без «self-delegation» в БД: «ответственный = я» — это просто отсутствие активной
// делегации, так что бэк не нужен (withdraw/delegate/reassign уже есть). Не-создатель видит
// ответственного только для чтения (менять делегацию может лишь создатель).
export function DelegateTaskButton({
  task,
  currentUserId,
  onChanged,
  projectId,
  className,
}: Props): React.ReactElement | null {
  const { projectRepository, taskRepository, taskDelegationRepository } = useContainer();
  const { user } = useCurrentUser();
  const [members, setMembers] = useState<SharedMember[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isCreator =
    currentUserId !== null && task.delegation
      ? task.delegation.creatorUserId === currentUserId
      : true; // без delegation caller — владелец задачи (= создатель), иначе он бы её не видел

  // Участников грузим ВСЕГДА (селектор виден всегда). Себя исключаем — «Я» отдельным пунктом.
  useEffect(() => {
    let cancelled = false;
    const load = projectId
      ? projectRepository.listMembers(projectId).then((list) =>
          list
            .filter((m) => m.userId !== currentUserId)
            .map((m) => ({
              id: m.userId,
              displayName: m.user.displayName,
              email: m.user.email,
              avatarUrl: m.user.avatarUrl,
            })),
        )
      : projectRepository.listSharedMembers();
    load
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId, currentUserId]);

  const delegatedTo = task.delegation
    ? { name: task.delegation.delegateDisplayName, avatarUrl: task.delegation.delegateAvatarUrl ?? null }
    : null;
  const isSelfAssigned = !delegatedTo;
  const meName = user?.displayName ?? 'Я';
  const meAvatar = user?.avatarUrl ?? null;
  // Создатель (неизменный): из делегации, либо — если делегации нет — задача «моя», отдельного
  // создателя не показываем (single-ава), чтобы не приписать чужую задачу себе.
  const creator = task.delegation
    ? { name: task.delegation.creatorDisplayName, avatarUrl: task.delegation.creatorAvatarUrl ?? null }
    : null;
  const assignee = delegatedTo ?? { name: meName, avatarUrl: meAvatar };

  const inPropertyRow = (className ?? '').includes('justify-start');

  // Не-создатель — только чтение: создатель → ответственный (стрелка, если делегировано).
  if (!isCreator) {
    return (
      <span className={cn('inline-flex min-h-7 items-center gap-1.5 text-sm text-foreground', className)}>
        {creator && (
          <>
            <MiniAvatar name={creator.name} avatarUrl={creator.avatarUrl} />
            <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />
          </>
        )}
        <MiniAvatar name={assignee.name} avatarUrl={assignee.avatarUrl} />
        <span className="min-w-0 truncate">{assignee.name}</span>
      </span>
    );
  }

  const select = async (target: SharedMember | 'self'): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (target === 'self') {
        // Забрать себе: закрываем активную делегацию (reclaim). Уже я — тихо ничего не делаем.
        if (task.delegation) {
          await taskDelegationRepository.withdraw(task.delegation.id);
          toast.success('Ответственный — вы');
          onChanged();
        }
      } else if (task.delegation) {
        if (task.delegation.delegateUserId !== target.id) {
          await taskRepository.reassign(task.projectId, task.id, target.id);
          toast.success(`Ответственный — ${target.displayName}`);
          onChanged();
        }
      } else {
        await taskRepository.delegate(task.projectId, task.id, target.id);
        toast.success(`Ответственный — ${target.displayName}`);
        onChanged();
      }
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          className={cn(
            inPropertyRow ? 'text-foreground hover:text-foreground' : META_CHIP_CLASS,
            className,
          )}
          title="Ответственный за задачу (создатель → ответственный). Нажмите, чтобы изменить."
        >
          {submitting ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <>
              {/* Создатель (неизменный) → стрелка → ответственный (меняется по клику). */}
              {creator && (
                <>
                  <MiniAvatar name={creator.name} avatarUrl={creator.avatarUrl} />
                  <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />
                </>
              )}
              <MiniAvatar name={assignee.name} avatarUrl={assignee.avatarUrl} />
            </>
          )}
          <span className="min-w-0 truncate">{assignee.name}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        {/* «Я» — всегда доступен (забрать задачу себе). */}
        <DropdownMenuItem onClick={() => void select('self')} className="gap-2">
          <MiniAvatar name={meName} avatarUrl={meAvatar} />
          <span className="min-w-0 truncate">{meName}</span>
          <span className="ml-1 shrink-0 text-[10px] text-muted-foreground">(вы)</span>
          {isSelfAssigned && <Check className="ml-auto size-3.5 shrink-0 text-primary" />}
        </DropdownMenuItem>
        {members === null ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Загрузка…</div>
        ) : members.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Делегировать участнику
            </div>
            {members.map((m) => {
              const active = task.delegation?.delegateUserId === m.id;
              return (
                <DropdownMenuItem key={m.id} onClick={() => void select(m)} className="gap-2">
                  <MiniAvatar name={m.displayName} avatarUrl={m.avatarUrl} />
                  <span className="min-w-0 truncate">{m.displayName}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{m.email}</span>
                  {active && <Check className="size-3.5 shrink-0 text-primary" />}
                </DropdownMenuItem>
              );
            })}
          </>
        ) : (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            В проекте пока нет других участников — задача за вами. Пригласите кого-то, чтобы делегировать.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Компактный аватар 20px — фото или цветные инициалы (детерминированный цвет по имени).
function MiniAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }): React.ReactElement {
  return (
    <Avatar className="size-5 shrink-0 rounded-[25%]">
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name} className="object-cover" />}
      <AvatarFallback className={cn('rounded-[25%] text-[9px] font-semibold', avatarColor(name))}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
