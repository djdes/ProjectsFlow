import { useEffect, useState } from 'react';
import { User, UserPlus } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { useContainer } from '@/infrastructure/di/container';
import type { SharedMember } from '@/application/project/ProjectRepository';

type Props = {
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  className?: string;
  // Если передан — грузим участников конкретного проекта (listMembers) вместо
  // глобального listSharedMembers. Для совместных (не inbox) проектов.
  projectId?: string;
};

// Single-select dropdown для выбора делегата при создании inbox-задачи.
// Icon-only кнопка: UserPlus когда выбран делегат, User когда нет.
// Список — люди из моих shared-проектов (без меня самого). При пустом списке
// показывает hint «пригласите кого-то в проект».
export function DelegateSelect({ value, onChange, disabled, className, projectId }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [members, setMembers] = useState<SharedMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadMembers = projectId
      ? projectRepository.listMembers(projectId).then((list) =>
          list.map((m) => ({ id: m.userId, displayName: m.user.displayName, email: m.user.email })),
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
  }, [projectRepository, projectId]);

  const selected = members?.find((m) => m.id === value) ?? null;
  const title = selected
    ? `Делегировано: ${selected.displayName}`
    : 'Делегировать';

  // Ряд свойств задачи (TaskDrawer «Ответственный») передаёт PROPERTY_VALUE_CLASS с
  // `justify-start` — там кнопка текстовая: «Выбрать…» в пустом состоянии, аватар(ы)
  // выбранного участника когда задан. В композерах/диалогах оставляем icon-кнопку.
  const inPropertyRow = (className ?? '').includes('justify-start');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {inPropertyRow ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className={cn(
              value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              className,
            )}
            title={title}
            aria-label={title}
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Avatar className="size-5 shrink-0">
                  <AvatarFallback
                    className={cn('text-[9px]', avatarColor(selected.displayName))}
                  >
                    {getInitials(selected.displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{selected.displayName}</span>
              </span>
            ) : (
              'Выбрать…'
            )}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className={cn(
              'shrink-0',
              value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              className,
            )}
            title={title}
            aria-label={title}
          >
            {value ? <UserPlus className="size-4" /> : <User className="size-4" />}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuItem onClick={() => onChange(null)}>
          Не делегировать
        </DropdownMenuItem>
        {members && members.length > 0 && <DropdownMenuSeparator />}
        {(members ?? []).map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)} className="gap-2">
            <span className={cn(m.id === value && 'font-medium')}>{m.displayName}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{m.email}</span>
          </DropdownMenuItem>
        ))}
        {members && members.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Нет общих участников.<br />
            Пригласите кого-то в проект — потом сможете делегировать.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
