import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';

type Props = {
  projectId: string;
  description: string | null;
  canEdit: boolean;
};

const MAX_LEN = 2000;

// Описание проекта под заголовком (Notion-style). Всегда редактируемое поле — как чистый лист:
// кликаешь в любом месте и сразу пишешь, без промежуточного «режима правки» и без рамок вокруг.
// Автосохранение по blur, откат по Esc, Cmd/Ctrl+Enter — снять фокус (тоже сохраняет).
export function ProjectDescription({ projectId, description, canEdit }: Props): React.ReactElement | null {
  const { submit } = useUpdateProject();
  const [draft, setDraft] = useState(description ?? '');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);

  const autosize = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Внешнее обновление (смена проекта / сохранение с другого клиента) — синхронизируем черновик,
  // но только пока поле не в фокусе: иначе затрём то, что юзер печатает прямо сейчас.
  useEffect(() => {
    if (!focused.current) setDraft(description ?? '');
  }, [description]);

  // Автовысота: при монтировании и при любой смене значения (в т.ч. извне).
  useLayoutEffect(() => {
    if (areaRef.current) autosize(areaRef.current);
  }, [draft]);

  const save = (): void => {
    focused.current = false;
    const trimmed = draft.trim();
    if (trimmed === (description ?? '')) return;
    void submit(projectId, { description: trimmed.length > 0 ? trimmed : null }).catch((e) => {
      toast.error(`Не удалось сохранить описание: ${(e as Error).message}`);
    });
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(description ?? '');
      areaRef.current?.blur();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      areaRef.current?.blur();
    }
  };

  // Читатель (нет прав на правку): просто текст, без поля. Пусто — ничего не рендерим.
  if (!canEdit) {
    const trimmed = (description ?? '').trim();
    if (trimmed.length === 0) return null;
    return (
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{trimmed}</p>
    );
  }

  return (
    <textarea
      ref={areaRef}
      value={draft}
      maxLength={MAX_LEN}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        autosize(e.target);
      }}
      onBlur={save}
      onKeyDown={handleKey}
      placeholder="Добавьте описание проекта…"
      rows={1}
      className={cn(
        'block w-full resize-none overflow-hidden bg-transparent p-0 text-[15px] leading-relaxed text-foreground/90 outline-none',
        'placeholder:text-muted-foreground/50',
      )}
      aria-label="Описание проекта"
    />
  );
}
