import * as React from 'react';
import { lazy, Suspense } from 'react';

import { Markdown } from '@/presentation/components/markdown/Markdown';
import type { RichTextEditorHandle } from '@/presentation/components/editor/RichTextEditor';

// Tiptap-редактор грузим лениво (тяжёлый). Тот же модуль, что и в TaskDrawer/комментариях —
// Vite дедуплицирует chunk, повторной загрузки нет.
const RichTextEditor = lazy(() =>
  import('@/presentation/components/editor/RichTextEditor').then((m) => ({
    default: m.RichTextEditor,
  })),
);

// ТЕЛО задачи (Notion-style): всегда-редактируемый WYSIWYG (RichTextEditor) прямо под
// заголовком. В отличие от старого click-to-edit описания, тело редактируется сразу —
// bubble/right-click-меню форматирования, @-упоминания, вставка файлов, чеклисты
// (TaskItem интерактивен в editable-режиме).
//
// Источник правды — родитель (TaskDrawer): он держит ПОЛНОЕ описание и режет его на
// title/body. Сюда приходит только `body`; обратно склейка с заголовком идёт через
// `onCommit` уровнем выше. AI-переработка работает над ПОЛНЫМ описанием (заголовок + тело),
// результат снова делится на title/body уровнем выше.

type Props = {
  // Текущее тело (markdown без первой строки-заголовка).
  body: string;
  // Локальное изменение тела (каждый ввод) — родитель пересобирает полное описание.
  onBodyChange: (nextBody: string) => void;
  // Сохранить ПОЛНОЕ описание в задачу (родитель уже знает title+body). Вызывается
  // на blur редактора / Ctrl+Cmd+Enter.
  onCommit: () => void;
  // Вставка файлов из буфера → прикрепляем к задаче через drawer.
  onPasteFiles?: (files: File[]) => void;
  // Загрузка вставленной картинки как inline-блок (вернуть URL вложения / null при ошибке).
  onUploadImage?: (file: File, onProgress: (pct: number) => void) => Promise<string | null>;
  disabled?: boolean;
  // Плейсхолдер редактора (по умолчанию — для тела; для объединённого поля переопределяем).
  placeholder?: string;
  // Императивный handle редактора — даёт родителю вставить чек-лист-пункт и сфокусироваться
  // (кнопка «+ Подзадача» в TaskDrawer).
  editorRef?: React.Ref<RichTextEditorHandle>;
};

// AI-кнопка переехала в ряд действий (Копировать/Переработать/План) в TaskDrawer —
// тут только редактор тела.
export function TaskBodyEditor({
  body,
  onBodyChange,
  onCommit,
  onPasteFiles,
  onUploadImage,
  disabled = false,
  placeholder = 'Описание, детали, подзадачи…',
  editorRef,
}: Props): React.ReactElement {
  return (
    <div className="relative">
      <Suspense
        fallback={
          <div className="min-h-[1.75rem] py-1.5 text-sm leading-snug">
            {body.trim().length > 0 ? (
              <Markdown>{body}</Markdown>
            ) : (
              <span className="italic text-muted-foreground">Описание…</span>
            )}
          </div>
        }
      >
        <RichTextEditor
          ref={editorRef}
          variant="description"
          // Меню форматирования — только по правой кнопке (не по выделению).
          selectionMenu={false}
          value={body}
          onChange={onBodyChange}
          // Ctrl/Cmd+Enter внутри тела → тоже сохранить полное описание.
          onSubmit={() => onCommit()}
          onBlur={() => onCommit()}
          disabled={disabled}
          onPasteFiles={onPasteFiles}
          onUploadImage={onUploadImage}
          placeholder={placeholder}
          // БЕЗ собственного max-h/scroll: тело всегда раскрыто на полную высоту, чтобы
          // скролл был ОДИН (колонка в split / окно в narrow), а не «2 поля» внутри задачи.
          className="py-1.5 text-sm leading-snug"
        />
      </Suspense>
    </div>
  );
}
