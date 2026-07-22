import { X } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { setProjectBannersHidden } from './projectBannersSetting';

type Props = {
  // Per-banner colour/position tweaks. The blue banner sits in a short bar and centres its
  // cross vertically; the gradient onboarding banners are tall and pin it to the top edge.
  className?: string;
};

// Единый крестик всех плашек над доской проекта.
//
// Крестик НЕ прячет одну плашку локально: он включает общую настройку «плашки скрыты»
// (та же, что тумблер в меню «⋯»), поэтому после закрытия не показывается ни одна плашка
// нигде — ни на доске, ни в выехавшем окне задачи. Обратно включается только тумблером,
// поэтому по закрытию показываем тост: иначе «закрыл одну — пропали все» читается как баг.
export function ProjectBannerDismissButton({ className }: Props): React.ReactElement {
  const dismiss = (): void => {
    setProjectBannersHidden(true);
    toast('Плашки скрыты', {
      description: 'Вернуть — в меню проекта «⋯» → «Показать плашки».',
    });
  };

  return (
    <button
      type="button"
      onClick={dismiss}
      aria-label="Скрыть плашки"
      title="Скрыть плашки"
      className={cn(
        'absolute right-2 top-2 z-10 grid size-5 place-items-center rounded text-muted-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
        className,
      )}
    >
      <X className="size-3.5" />
    </button>
  );
}
