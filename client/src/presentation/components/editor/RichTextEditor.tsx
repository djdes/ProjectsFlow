import * as React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';

import { cn } from '@/lib/utils';
import { buildExtensions, type MentionMember } from './extensions/buildExtensions';
import { SlashCommand } from './extensions/slashCommand';
import { BubbleToolbar } from './BubbleToolbar';

export type { MentionMember };

export interface RichTextEditorProps {
  /** Markdown-строка (хранение неизменно — backend/mock получают markdown). */
  value: string;
  onChange: (markdown: string) => void;
  /** Comment-variant: Enter; description-variant: Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  variant?: 'description' | 'comment';
  /** Передать участников проекта, чтобы включить @-упоминания. */
  members?: MentionMember[];
  /** Вставка файлов из буфера (изображения и т.п.). */
  onPasteFiles?: (files: File[]) => void;
}

// Notion-style WYSIWYG: форматирование видно при наборе (без сырых `**`/`#`),
// bubble-меню по выделению, slash-меню «/», @-упоминания. Хранит/отдаёт markdown.
// Прозрачно заменяет textarea (контракт value/onChange зеркалит textarea).
const PROSE_CLASS =
  'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-w-0 [overflow-wrap:anywhere] ' +
  'prose-p:my-1.5 prose-headings:mb-1 prose-headings:mt-3 prose-pre:my-2 ' +
  'prose-ul:my-1.5 prose-ol:my-1.5 prose-blockquote:my-2';

export function RichTextEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus = false,
  disabled = false,
  className,
  variant = 'description',
  members,
  onPasteFiles,
}: RichTextEditorProps): React.ReactElement {
  // Колбэки через ref — чтобы не пересоздавать editor на каждом рендере.
  const onChangeRef = React.useRef(onChange);
  const onSubmitRef = React.useRef(onSubmit);
  const onPasteFilesRef = React.useRef(onPasteFiles);
  React.useEffect(() => {
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    onPasteFilesRef.current = onPasteFiles;
  });

  const editor = useEditor({
    extensions: [...buildExtensions({ placeholder, members }), SlashCommand],
    content: value,
    contentType: 'markdown',
    autofocus: autoFocus ? 'end' : false,
    editable: !disabled,
    immediatelyRender: true,
    editorProps: {
      attributes: { class: PROSE_CLASS },
      handleKeyDown: (_view, event) => {
        if (event.key !== 'Enter') return false;
        if (variant === 'comment') {
          if (event.shiftKey) return false; // Shift+Enter → перенос строки
          event.preventDefault();
          onSubmitRef.current?.();
          return true;
        }
        // description: отправка по Ctrl/Cmd+Enter
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onSubmitRef.current?.();
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0 && onPasteFilesRef.current) {
          event.preventDefault();
          onPasteFilesRef.current(files);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(e.getMarkdown());
    },
  });

  // Внешнее изменение value (AI-improve, сброс формы) → синхронизируем без эха onUpdate.
  React.useEffect(() => {
    if (!editor) return;
    if (value !== editor.getMarkdown()) {
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    }
  }, [value, editor]);

  React.useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  return (
    <div className={cn('relative', className)}>
      {editor ? <BubbleToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
