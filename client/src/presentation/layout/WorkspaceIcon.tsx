import { cn } from '@/lib/utils';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';

type Props = {
  name: string;
  icon: string | null;
  // tailwind size-* класс контейнера (по умолчанию size-6).
  className?: string;
  // Пиксельный размер для lucide-иконки внутри (эмодзи/буква масштабируются font-size).
  iconPx?: number;
};

// Квадратная иконка проекта/пространства (Notion-style): нейтральный СЕРЫЙ квадрат с первой
// буквой названия — единообразно (без рандомных цветов). Если задана иконка — эмодзи, lucide
// или картинка (см. ProjectIconView) — показываем её (картинка заполняет квадрат целиком).
export function WorkspaceIcon({ name, icon, className, iconPx = 16 }: Props): React.ReactElement {
  const letter = name.trim()[0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md text-[11px] font-semibold',
        'bg-foreground/[0.06] text-foreground/70 dark:bg-white/[0.08] dark:text-white/80',
        className ?? 'size-6',
      )}
    >
      {/* Глиф с leading-none центрируется флексом — одиночная буква не «съезжает». */}
      {icon ? (
        <ProjectIconView icon={icon} pixelSize={iconPx} className="leading-none" />
      ) : (
        <span className="leading-none">{letter}</span>
      )}
    </span>
  );
}
