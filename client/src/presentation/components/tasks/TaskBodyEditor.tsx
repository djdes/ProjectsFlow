import * as React from 'react';
import { lazy, Suspense, useRef } from 'react';

import { Markdown } from '@/presentation/components/markdown/Markdown';
import { AiComposeDialog } from '@/presentation/components/ai/AiComposeDialog';

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
      {/* AI-контрол — поверх текста в правом верхнем углу тела (как было у описания).
          Работает над ПОЛНЫМ описанием (заголовок + тело). bg/blur — чтобы текст под
          кластером оставался читаемым. */}
      <div className="absolute right-0 top-0 z-10 flex items-center gap-0.5 rounded-md bg-background/85 px-0.5 backdrop-blur-sm">
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
          variant="description"
          value={body}
          onChange={onBodyChange}
          // Ctrl/Cmd+Enter внутри тела → тоже сохранить полное описание.
          onSubmit={() => onCommit()}
          onBlur={handleEditorBlur}
          disabled={disabled}
          onPasteFiles={onPasteFiles}
          placeholder="Описание, детали, подзадачи…"
          className="max-h-[50vh] overflow-y-auto py-1.5 text-sm leading-snug"
        />
      </Suspense>
    </div>
  );
}
