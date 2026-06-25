import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

// Notion-style редактор ЗАГОЛОВКА задачи. В отличие от тела (RichTextEditor / WYSIWYG)
// это всегда-редактируемое plain-поле: одна строка, жирный крупный шрифт, без какого-либо
// форматирования (никаких markdown/bold-меню — заголовок всегда просто жирный текст).
//
// Поведение:
//  - редактируется по ОДНОМУ клику (textarea всегда в DOM, фокус по клику мгновенный);
//  - auto-grow по высоте (перенос длинного заголовка на узких экранах вплоть до 320px);
//  - Enter НЕ вставляет перенос строки — переводит фокус в тело (onEnter);
//  - сохранение — debounce при наборе + немедленно на blur (через onCommit).

type Props = {
  value: string;
  // Локальное изменение (каждый ввод) — родитель держит актуальное значение в state.
  onChange: (next: string) => void;
  // Сохранить текущее значение (debounced при наборе / сразу на blur). Родитель
  // склеивает заголовок с телом и пишет в `description`.
  onCommit: () => void;
  // Enter в заголовке → перевести фокус в тело (вместо переноса строки).
  onEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
};

// Задержка автосейва при наборе — чтобы не дёргать сервер на каждый символ.
const COMMIT_DEBOUNCE_MS = 600;

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
  // Колбэк через ref — чтобы debounce-таймер всегда видел свежий onCommit без перезапуска.
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  // Auto-grow: высота по контенту. Сбрасываем в 'auto' перед чтением scrollHeight, иначе
  // поле не умеет ужиматься обратно после удаления строк.
  const resize = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Подгоняем высоту при внешнем изменении value (смена задачи, AI-improve тела и т.п.).
  useEffect(() => {
    resize();
  }, [value, resize]);

  // Чистим debounce при размонтировании (без финального flush — blur/unmount тела
  // у родителя страхуют сохранение; здесь важно лишь не стрелять таймером в мёртвый компонент).
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    // Гарантируем одну строку: вставленные переносы (paste многострочного текста)
    // схлопываем в пробелы — заголовок всегда однострочный.
    const next = e.target.value.replace(/\r?\n/g, ' ');
    onChange(next);
    resize();
    scheduleCommit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter') {
      // Enter не переносит строку — уводит фокус в тело.
      e.preventDefault();
      // Сразу зафиксируем заголовок перед уходом, отменив pending-debounce.
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      onCommitRef.current();
      onEnter?.();
    }
  };

  const handleBlur = (): void => {
    // На blur — сохраняем немедленно, отменяя pending-debounce.
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    onCommitRef.current();
  };

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      autoFocus={autoFocus}
      spellCheck={false}
      aria-label="Название задачи"
      className={cn(
        // Всегда жирный крупный заголовок (ink-цвет). resize-none + overflow-hidden —
        // высоту контролирует auto-grow. Без рамки/фона: выглядит как чистый текст.
        'block w-full resize-none overflow-hidden border-0 bg-transparent p-0 ' +
          'text-2xl font-semibold leading-tight tracking-tight text-foreground ' +
          'outline-none placeholder:font-semibold placeholder:text-muted-foreground/50 ' +
          'focus:outline-none focus-visible:outline-none disabled:opacity-60',
        className,
      )}
    />
  );
}
