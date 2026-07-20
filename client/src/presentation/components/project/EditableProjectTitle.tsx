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
      // Метрика 1:1 с Notion (снято через CDP, MEASURED.md §2): 32px / 700 / line-height
      // 38.4px (= 1.2) / letter-spacing normal. Бампа до 2.5rem на десктопе больше нет и
      // tracking-tight убран — именно они давали «не как в Notion»: наш заголовок был крупнее
      // и плотнее оригинала. От этих 38.4px пляшет и квадрат инлайн-иконки проекта
      // (ProjectIconPicker, sm:size-[2.4rem]) — иначе высоту ряда задаёт иконка, а не название.
      //
      // ⚠️ Известное ограничение на мобиле: заголовок — это <input>, а globals.css (анти-зум
      // iOS) форсит всем инпутам под 640px `font-size: 16px !important`. Специфичность того
      // селектора (0,8,1) не перебивается ни `text-*`, ни `!text-*`, ни sm-веткой, поэтому на
      // телефоне название рендерится 16px жирным — как обычный текст, а не как заголовок.
      // Лечится только сменой элемента (contenteditable вместо input); это не косметика —
      // на input завязаны автосейв по blur, откат по Esc и maxLength, поэтому отдельной задачей.
      className={cn(
        'w-full min-w-0 bg-transparent p-0 font-bold text-foreground outline-none',
        'text-[2rem] leading-[1.2] placeholder:text-muted-foreground/40',
      )}
    />
  );
}
