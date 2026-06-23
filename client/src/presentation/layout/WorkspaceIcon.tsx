import { cn } from '@/lib/utils';
import { avatarColor } from './projectIcons';

type Props = {
  name: string;
  icon: string | null;
  // tailwind size-* класс контейнера (по умолчанию size-6).
  className?: string;
};

// Квадратная иконка пространства: эмодзи (если задано) или первая буква названия
// на детерминированном по названию цветном фоне.
export function WorkspaceIcon({ name, icon, className }: Props): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-md text-[11px] font-semibold',
        icon ? 'bg-foreground/[0.04] dark:bg-white/[0.06]' : avatarColor(name),
        className ?? 'size-6',
      )}
    >
      {icon ?? (name.trim()[0]?.toUpperCase() ?? '?')}
    </span>
  );
}
