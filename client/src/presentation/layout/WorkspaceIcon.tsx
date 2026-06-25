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
  // Глиф оборачиваем в отдельный span с leading-none и центрируем флексом — так одиночная
  // буква не «съезжает» (сырой текст в гриде из-за базовой линии вставал чуть выше центра).
  const glyph = icon ?? (name.trim()[0]?.toUpperCase() ?? '?');
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-[11px] font-semibold',
        'bg-foreground/[0.06] text-foreground/70 dark:bg-white/[0.08] dark:text-white/80',
        className ?? 'size-6',
      )}
    >
      <span className="leading-none">{glyph}</span>
    </span>
  );
}
