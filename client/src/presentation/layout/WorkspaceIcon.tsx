import { cn } from '@/lib/utils';

type Props = {
  name: string;
  icon: string | null;
  // tailwind size-* класс контейнера (по умолчанию size-6).
  className?: string;
};

// Квадратная иконка пространства (Notion-style): нейтральный СЕРЫЙ квадрат с первой буквой
// названия — единообразно для всех пространств (без рандомных цветов). Если задан эмодзи —
// показываем его на том же сером фоне.
export function WorkspaceIcon({ name, icon, className }: Props): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-md text-[11px] font-semibold leading-none',
        'bg-foreground/[0.06] text-foreground/70 dark:bg-white/[0.08] dark:text-white/80',
        className ?? 'size-6',
      )}
    >
      {icon ?? (name.trim()[0]?.toUpperCase() ?? '?')}
    </span>
  );
}
