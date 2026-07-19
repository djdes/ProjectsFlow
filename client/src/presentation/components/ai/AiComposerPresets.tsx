import { BrainCircuit, Code2, FileSearch, ListChecks } from 'lucide-react';

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
    <div className={className}>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {AI_COMPOSER_PRESETS.map(({ icon: Icon, title, prompt }) => (
          <button
            key={title}
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt)}
            className="flex min-h-16 flex-col items-start gap-1.5 rounded-xl border bg-card px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="grid size-7 place-items-center rounded-lg bg-muted"><Icon className="size-3.5" /></span>
            <span className="text-xs font-medium leading-4">{title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
