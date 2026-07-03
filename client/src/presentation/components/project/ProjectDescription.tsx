import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';

type Props = {
  projectId: string;
  description: string | null;
  canEdit: boolean;
};

const MAX_LEN = 2000;

// Описание проекта под заголовком (Notion-style): клик по пустому месту → редактирование.
// Пустое + нет прав → ничего не рендерим. Сохранение — по blur, отмена — Esc.
export function ProjectDescription({ projectId, description, canEdit }: Props): React.ReactElement | null {
  const { submit, saving } = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (editing) {
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }
    }
  }, [editing]);

  const start = (): void => {
    if (!canEdit) return;
    setDraft(description ?? '');
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed === (description ?? '')) return;
    try {
      await submit(projectId, { description: trimmed.length > 0 ? trimmed : null });
    } catch (e) {
      toast.error(`Не удалось сохранить описание: ${(e as Error).message}`);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(description ?? '');
      setEditing(false);
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  if (editing) {
    return (
      <textarea
        ref={areaRef}
        value={draft}
        maxLength={MAX_LEN}
        disabled={saving}
        onChange={(e) => {
          setDraft(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onBlur={() => void save()}
        onKeyDown={handleKey}
        placeholder="Добавьте описание проекта…"
        rows={1}
        className={cn(
          'w-full resize-none overflow-hidden rounded-md bg-transparent text-[15px] leading-relaxed text-foreground/90 outline-none',
          'placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/40',
          'px-2 py-1 -mx-2',
        )}
        aria-label="Описание проекта"
      />
    );
  }

  const trimmed = (description ?? '').trim();

  if (trimmed.length === 0) {
    if (!canEdit) return null;
    return (
      <button
        type="button"
        onClick={start}
        className="-mx-2 rounded-md px-2 py-1 text-left text-[15px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        Добавьте описание проекта…
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={!canEdit}
      className={cn(
        '-mx-2 block w-full whitespace-pre-wrap rounded-md px-2 py-1 text-left text-[15px] leading-relaxed text-foreground/90',
        canEdit && 'transition-colors hover:bg-muted/50',
      )}
    >
      {trimmed}
    </button>
  );
}
