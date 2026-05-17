import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';

type Props = {
  projectId: string;
  name: string;
};

const MAX_LEN = 80;

export function EditableProjectTitle({ projectId, name }: Props): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const { submit, saving } = useUpdateProject();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const start = (): void => {
    setDraft(name);
    setEditing(true);
  };

  const cancel = (): void => {
    setDraft(name);
    setEditing(false);
  };

  const save = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      toast.error('Название не может быть пустым');
      return;
    }
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    try {
      await submit(projectId, { name: trimmed });
      setEditing(false);
    } catch (e) {
      toast.error(`Не удалось переименовать: ${(e as Error).message}`);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onBlur={() => void save()}
          maxLength={MAX_LEN}
          disabled={saving}
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-3xl font-semibold tracking-tight outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Название проекта"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault() /* не дать input'у блюрнуться */}
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="Сохранить"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          disabled={saving}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="Отмена"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      className="group flex items-center gap-2 rounded-md px-0 py-0 text-left"
      aria-label="Изменить название проекта"
    >
      <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
      <Pencil className="size-4 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
