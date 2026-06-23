import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { defaultProjectIcon as FolderIcon } from '@/presentation/layout/projectIcons';

// Курируемая палитра (Notion-style): достаточно для индивидуальности без
// полноценного emoji-пикера (новых зависимостей не вводим — см. CLAUDE.md).
// Экспортируется для переиспользования (напр., иконка пространства).
export const EMOJI = [
  '🚀', '🎯', '⭐', '🔥', '💡', '📦', '🛠️', '⚙️',
  '💻', '🖥️', '📱', '🌐', '🤖', '🧠', '🔬', '🧪',
  '📈', '📊', '💰', '🏦', '🛒', '🏷️', '📝', '📚',
  '🎵', '🎧', '🎬', '🎨', '📷', '🎮', '🏠', '🏗️',
  '✈️', '🚗', '🌱', '🌍', '☀️', '🌙', '❤️', '✅',
] as const;

type Props = {
  projectId: string;
  icon: string | null;
};

// Иконка проекта рядом с заголовком: эмодзи (или дефолтная папка) → клик
// открывает поповер с палитрой. Выбор PATCH'ится сразу; список проектов
// обновится через useUpdateProject (он дёргает refresh контекста).
export function ProjectIconPicker({ projectId, icon }: Props): React.ReactElement {
  const { submit, saving } = useUpdateProject();
  const [open, setOpen] = useState(false);

  const choose = async (next: string | null): Promise<void> => {
    setOpen(false);
    if (next === icon) return;
    try {
      await submit(projectId, { icon: next });
    } catch (e) {
      toast.error(`Не удалось сменить иконку: ${(e as Error).message}`);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          aria-label="Сменить иконку проекта"
          title="Иконка проекта"
          className="grid size-9 shrink-0 place-items-center rounded-md text-2xl leading-none transition-colors hover:bg-accent disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : icon ? (
            <span aria-hidden>{icon}</span>
          ) : (
            <FolderIcon className="size-5 text-muted-foreground" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-2">
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => void choose(e)}
              className={cn(
                'grid size-7 place-items-center rounded-md text-base transition-colors hover:bg-accent',
                e === icon && 'bg-accent ring-1 ring-primary/40',
              )}
              aria-label={`Иконка ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
        {icon && (
          <button
            type="button"
            onClick={() => void choose(null)}
            className="mt-1.5 w-full rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Убрать иконку
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
