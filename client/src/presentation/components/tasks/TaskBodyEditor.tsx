import * as React from 'react';
import { lazy, Suspense, useRef } from 'react';

import { Markdown } from '@/presentation/components/markdown/Markdown';
import { AiComposeDialog } from '@/presentation/components/ai/AiComposeDialog';
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
  projectId: string;
  taskId: string;
  // Текущее тело (markdown без первой строки-заголовка).
  body: string;
  // Полное описание (title+body) — отдаём AI-диалогу как исходный текст для переработки.
  fullDescription: string;
  // Локальное изменение тела (каждый ввод) — родитель пересобирает полное описание.
  onBodyChange: (nextBody: string) => void;
  // Сохранить ПОЛНОЕ описание в задачу (родитель уже знает title+body). Вызывается
  // на blur редактора / Ctrl+Cmd+Enter.
  onCommit: () => void;
  // AI «Применить»: переработанное ПОЛНОЕ описание — родитель разрежет на title/body и сохранит.
  onAiImproved: (fullDescription: string) => void;
  // AI «Распределить»: задача обновлена/создана server-side → родитель перефетчит доску.
  onAiDistributed: () => void;
  // Вставка файлов из буфера → прикрепляем к задаче через drawer.
  onPasteFiles?: (files: File[]) => void;
  disabled?: boolean;
  // Плейсхолдер редактора (по умолчанию — для тела; для объединённого поля переопределяем).
  placeholder?: string;
  // Императивный handle редактора — даёт родителю вставить чек-лист-пункт и сфокусироваться
  // (кнопка «+ Подзадача» в TaskDrawer).
  editorRef?: React.Ref<RichTextEditorHandle>;
};

export function TaskBodyEditor({
  projectId,
  taskId,
  body,
  fullDescription,
  onBodyChange,
  onCommit,
  onAiImproved,
  onAiDistributed,
  onPasteFiles,
  disabled = false,
  placeholder = 'Описание, детали, подзадачи…',
  editorRef,
}: Props): React.ReactElement {
  // Клик по AI открывает Radix-диалог, который перехватывает фокус → редактор получает
  // blur. Этот флаг (взводится на mousedown по AI) гасит blur-save, чтобы не было лишней
  // записи: запись делает сам AI-flow.
  const aiOpeningRef = useRef(false);

  const handleEditorBlur = (): void => {
    if (aiOpeningRef.current) {
      aiOpeningRef.current = false;
      return;
    }
    onCommit();
  };

  return (
    <div className="relative">
      {/* AI-контрол — аккуратная плавающая «таблетка» в правом верхнем углу тела (отступ
          от края, бордер + тень, чтобы не выглядела криво и не сливалась с текстом). */}
      <div className="absolute right-1 top-1 z-10 flex items-center rounded-lg border bg-background/95 shadow-sm backdrop-blur-sm">
        {/* preventDefault — клик по AI не уводит фокус мгновенно; aiOpeningRef гасит
            blur-save, который иначе сработает, когда Radix-диалог перехватит фокус. */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            aiOpeningRef.current = true;
            window.setTimeout(() => {
              aiOpeningRef.current = false;
            }, 300);
          }}
        >
          <AiComposeDialog
            text={fullDescription}
            projectId={projectId}
            editTask={{ projectId, taskId }}
            onImproved={(next) => onAiImproved(next)}
            onDistributed={() => onAiDistributed()}
            disabled={disabled}
            compact
          />
        </div>
      </div>

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
          value={body}
          onChange={onBodyChange}
          // Ctrl/Cmd+Enter внутри тела → тоже сохранить полное описание.
          onSubmit={() => onCommit()}
          onBlur={handleEditorBlur}
          disabled={disabled}
          onPasteFiles={onPasteFiles}
          placeholder={placeholder}
          // БЕЗ собственного max-h/scroll: тело всегда раскрыто на полную высоту, чтобы
          // скролл был ОДИН (колонка в split / окно в narrow), а не «2 поля» внутри задачи.
          className="py-1.5 text-sm leading-snug"
        />
      </Suspense>
    </div>
  );
}
