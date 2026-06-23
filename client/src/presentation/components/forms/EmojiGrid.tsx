import { cn } from '@/lib/utils';
import { EMOJI } from '@/presentation/components/project/ProjectIconPicker';

type Props = {
  value: string | null;
  onChange: (icon: string | null) => void;
};

// Сетка курируемых эмодзи для выбора иконки пространства. Повторный клик по выбранному
// снимает иконку (null → дефолтная буква).
export function EmojiGrid({ value, onChange }: Props): React.ReactElement {
  return (
    <div className="grid grid-cols-8 gap-0.5 rounded-md border p-2">
      {EMOJI.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onChange(value === e ? null : e)}
          className={cn(
            'grid size-7 place-items-center rounded-md text-base transition-colors hover:bg-accent',
            e === value && 'bg-accent ring-1 ring-primary/40',
          )}
          aria-label={`Иконка ${e}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
