import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';

type Props = {
  projectId: string;
  name: string;
};

const MAX_LEN = 80;

// Название проекта (Notion-style): всегда редактируемое seamless-поле — как чистый текст.
// Кликаешь и сразу пишешь/выделяешь, без рамок, кнопок и «режима правки». Крупный размер
// как в Notion. Автосейв по blur, откат по Esc, Enter — снять фокус (сохраняет).
export function EditableProjectTitle({ projectId, name }: Props): React.ReactElement {
  const { submit } = useUpdateProject();
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);

  // Внешнее обновление имени (смена проекта / сохранение с другого клиента) — синхронизируем,
  // пока поле не в фокусе (не затираем ввод пользователя).
  useEffect(() => {
    if (!focused.current) setDraft(name);
  }, [name]);

  const save = (): void => {
    focused.current = false;
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setDraft(name); // пустое имя не сохраняем — откатываем к текущему
      toast.error('Название не может быть пустым');
      return;
    }
    if (trimmed === name) return;
    void submit(projectId, { name: trimmed }).catch((e) => {
      setDraft(name);
      toast.error(`Не удалось переименовать: ${(e as Error).message}`);
    });
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(name);
      inputRef.current?.blur();
    }
  };

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={save}
      onKeyDown={handleKey}
      maxLength={MAX_LEN}
      spellCheck={false}
      aria-label="Название проекта"
      placeholder="Без названия"
      className={cn(
        'w-full min-w-0 bg-transparent p-0 font-bold tracking-tight text-foreground outline-none',
        'text-[2rem] leading-tight placeholder:text-muted-foreground/40 sm:text-[2.5rem]',
      )}
    />
  );
}
