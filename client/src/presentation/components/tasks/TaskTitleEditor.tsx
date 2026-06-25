import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  parseTitleHeading,
  formatTitleHeading,
  stripInlineMarkdown,
  type TitleHeadingLevel,
} from '@/lib/taskTitleBody';

// Notion-style редактор ЗАГОЛОВКА задачи. Всегда-редактируемое plain-поле: одна строка,
// жирный шрифт, БЕЗ видимых markdown-символов (`##` не показываем). Уровень заголовка
// (H1/H2/H3 или обычный текст) хранится в markdown-префиксе `#` первой строки, но НА ЭКРАНЕ
// его нет — размер задаётся стилем, а сменить размер можно правым кликом по заголовку.
//
// Контракт `value`/`onChange` — «сырая» первая строка (с `#`-префиксом, как в description).
// Внутри парсим её в {text, level}: в textarea кладём чистый text, наружу отдаём
// formatTitleHeading(text, level).

type Props = {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
};

const COMMIT_DEBOUNCE_MS = 600;

const LEVELS: ReadonlyArray<{ level: TitleHeadingLevel; label: string; cls: string }> = [
  { level: 0, label: 'Обычный текст', cls: 'text-base' },
  { level: 1, label: 'Заголовок 1', cls: 'text-2xl' },
  { level: 2, label: 'Заголовок 2', cls: 'text-xl' },
  { level: 3, label: 'Заголовок 3', cls: 'text-lg' },
];

const SIZE_BY_LEVEL: Record<TitleHeadingLevel, string> = {
  0: 'text-lg',
  1: 'text-2xl',
  2: 'text-xl',
  3: 'text-lg',
};

export function TaskTitleEditor({
  value,
  onChange,
  onCommit,
  onEnter,
  placeholder = 'Без названия',
  disabled = false,
  autoFocus = false,
  className,
}: Props): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<number | null>(null);
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  // Парсим «сырой» заголовок: на экран — чистый текст, размер — по уровню.
  // Дополнительно срезаем инлайн-markdown (`**`, `*`, `` ` ``, … ) — заголовок plain,
  // символов форматирования на экране быть не должно.
  const { text: rawText, level } = parseTitleHeading(value);
  const text = stripInlineMarkdown(rawText);

  // Меню выбора размера (правый клик), позиционируется у курсора.
  const [menu, setMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });

  const resize = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [text, resize]);

  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const scheduleCommit = useCallback((): void => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      onCommitRef.current();
    }, COMMIT_DEBOUNCE_MS);
  }, []);

  const flushCommit = (): void => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    onCommitRef.current();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextText = e.target.value.replace(/\r?\n/g, ' ');
    onChange(formatTitleHeading(nextText, level));
    resize();
    scheduleCommit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      flushCommit();
      onEnter?.();
    }
  };

  const pickLevel = (lvl: TitleHeadingLevel): void => {
    onChange(formatTitleHeading(text, lvl));
    setMenu((s) => ({ ...s, open: false }));
    flushCommit();
  };

  return (
    <>
      <textarea
        ref={ref}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={flushCommit}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ open: true, x: e.clientX, y: e.clientY });
        }}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        autoFocus={autoFocus}
        spellCheck={false}
        aria-label="Название задачи"
        className={cn(
          'block w-full resize-none overflow-hidden border-0 bg-transparent p-0 ' +
            'font-semibold leading-tight tracking-tight text-foreground ' +
            'outline-none placeholder:font-semibold placeholder:text-muted-foreground/50 ' +
            'focus:outline-none focus-visible:outline-none disabled:opacity-60',
          SIZE_BY_LEVEL[level],
          className,
        )}
      />

      {/* Правый клик по заголовку → выбор размера (Текст / H1 / H2 / H3). */}
      <Popover open={menu.open} onOpenChange={(o) => setMenu((s) => ({ ...s, open: o }))}>
        <PopoverAnchor asChild>
          <span aria-hidden style={{ position: 'fixed', left: menu.x, top: menu.y }} />
        </PopoverAnchor>
        <PopoverContent align="start" side="bottom" sideOffset={4} className="w-48 p-1">
          <div className="px-2 py-1 text-xs text-muted-foreground">Размер заголовка</div>
          {LEVELS.map((l) => (
            <button
              key={l.level}
              type="button"
              onClick={() => pickLevel(l.level)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover"
            >
              <span className={cn('flex-1 truncate font-semibold', l.cls)}>{l.label}</span>
              {l.level === level ? <Check className="size-4 shrink-0 text-foreground" /> : null}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </>
  );
}
