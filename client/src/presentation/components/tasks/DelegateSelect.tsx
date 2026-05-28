import { useEffect, useState } from 'react';
import { ChevronDown, User, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import type { SharedMember } from '@/application/project/ProjectRepository';

type Props = {
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  className?: string;
};

// Single-select dropdown для выбора делегата при создании inbox-задачи.
// Список — люди из моих shared-проектов (без меня самого). При пустом списке
// показывает hint «пригласите кого-то в проект».
export function DelegateSelect({ value, onChange, disabled, className }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [members, setMembers] = useState<SharedMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectRepository
      .listSharedMembers()
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository]);

  const selected = members?.find((m) => m.id === value) ?? null;
  const label = selected ? selected.displayName : 'Не делегировать';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            'h-7 gap-1.5 px-2 text-xs',
            value
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
            className,
          )}
          title="Делегировать одному из участников ваших общих проектов"
        >
          {value ? <UserPlus className="size-3.5" /> : <User className="size-3.5" />}
          {label}
          <ChevronDown className="size-3" />
        </Button>
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
