import { BrainCircuit, Code2, FileSearch, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';

export const AI_COMPOSER_PRESETS = [
  { icon: BrainCircuit, title: 'Продумать решение', prompt: 'Помоги продумать решение. Сначала задай важные уточняющие вопросы.' },
  { icon: FileSearch, title: 'Разобрать документ', prompt: 'Помоги разобрать документ и выделить главное.' },
  { icon: Code2, title: 'Обсудить код', prompt: 'Помоги разобраться с кодом и предложи безопасный план изменений.' },
  { icon: ListChecks, title: 'Собрать план задач', prompt: 'Помоги собрать план задач: разбей цель на шаги и предложи порядок работы.' },
] as const;

/**
 * Пресеты живут только на пустом чате: как только в диалоге появилось сообщение,
 * они исчезают (референс §5).
 */
export function AiComposerPresets({
  onPick,
  disabled = false,
  className,
}: {
  onPick: (prompt: string) => void;
  disabled?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('[container-type:inline-size]', className)}>
      {/* Адаптив по ширине КОНТЕЙНЕРА, а не вьюпорта (lg:grid-cols-4 ломал ряд в узкой
          боковой панели студии: viewport ≥1024 → всегда 4 колонки в 280–360px). Четыре
          пресета раскладываются только 2×2 или 4×1: прежний auto-fit давал на телефоне
          (контейнер ~360px) три колонки и одинокую четвёртую карточку во втором ряду. */}
      <div className="grid grid-cols-2 gap-2 [@container(min-width:34rem)]:grid-cols-4">
        {AI_COMPOSER_PRESETS.map(({ icon: Icon, title, prompt }) => (
          <button
            key={title}
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt)}
            className="flex min-h-16 flex-col items-start gap-1.5 rounded-lg bg-card px-3 py-2.5 text-start shadow-card transition-[background-color,box-shadow,opacity] hover:shadow-card-hover disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-card-hover"
          >
            <span className="grid size-7 place-items-center rounded-lg bg-muted"><Icon className="size-3.5" /></span>
            <span className="text-xs font-medium leading-4">{title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
