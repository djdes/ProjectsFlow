import * as React from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';

import { cn } from '@/lib/utils';
import { buildExtensions, type MentionMember } from './extensions/buildExtensions';
import { SlashCommand } from './extensions/slashCommand';
import { FloatingFormatMenu, type FloatingAnchor } from './FloatingFormatMenu';

export type { MentionMember };

// Если выделения нет — выделяем слово под курсором в точке клика, чтобы форматирование
// из контекстного меню применилось к нему (поведение Notion). Возвращает true, если
// курсор попал в текст (меню имеет смысл открывать).
function selectWordAt(editor: Editor, clientX: number, clientY: number): boolean {
  const { view } = editor;
  const posInfo = view.posAtCoords({ left: clientX, top: clientY });
  if (!posInfo) return false;
  const { state } = view;
  const { selection } = state;

  // Уже есть непустое выделение — не трогаем его (правый клик не должен «сбрасывать»).
  if (!selection.empty) return true;

  const pos = posInfo.pos;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) {
    // Не текстовый блок (например, hr) — просто ставим курсор, меню всё равно полезно.
    return true;
  }

  const blockStart = $pos.start();
  const text = parent.textContent;
  if (!text) {
    return true; // пустой блок — оставляем курсор, форматирование применится к набору
  }

  const offset = pos - blockStart;
  const isWord = (ch: string): boolean => /[\p{L}\p{N}_]/u.test(ch);

  let from = offset;
  let to = offset;
  while (from > 0 && isWord(text[from - 1] ?? '')) from -= 1;
  while (to < text.length && isWord(text[to] ?? '')) to += 1;

  if (from === to) {
    // Курсор на пробеле/пунктуации — просто ставим каретку.
    editor.chain().setTextSelection(pos).run();
    return true;
  }

  const tr = state.tr.setSelection(
    TextSelection.create(state.doc, blockStart + from, blockStart + to),
  );
  view.dispatch(tr);
  return true;
}

export interface RichTextEditorProps {
  /** Markdown-строка (хранение неизменно — backend/mock получают markdown). */
  value: string;
  onChange: (markdown: string) => void;
  /** Comment-variant: Enter; description-variant: Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
  /**
   * Потеря фокуса полем редактора. НЕ срабатывает, когда фокус ушёл во
   * floating-UI самого редактора (bubble-меню / slash / @-упоминания —
   * они портируются в body с классом `bg-popover`).
   */
  onBlur?: () => void;
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
  onBlur,
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
  const onBlurRef = React.useRef(onBlur);
  const onPasteFilesRef = React.useRef(onPasteFiles);
  React.useEffect(() => {
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    onBlurRef.current = onBlur;
    onPasteFilesRef.current = onPasteFiles;
  });

  // Плавающее меню форматирования (по выделению И по правому клику). Якорь в
  // координатах вьюпорта; null — меню скрыто.
  const [menuAnchor, setMenuAnchor] = React.useState<FloatingAnchor | null>(null);
  // Ключ «закрытого» выделения — чтобы после Escape/действия меню не всплывало
  // снова для того же выделения (всплывёт, когда выделение сменится).
  const dismissedKeyRef = React.useRef<string | null>(null);
  // editor нужен внутри handleDOMEvents, который создаётся до объявления editor —
  // читаем через ref, чтобы не пересоздавать конфигурацию.
  const editorRef = React.useRef<Editor | null>(null);

  const selectionKey = (e: Editor): string => `${e.state.selection.from}-${e.state.selection.to}`;
  const closeMenu = React.useCallback(() => {
    const e = editorRef.current;
    if (e && !e.isDestroyed) dismissedKeyRef.current = selectionKey(e);
    setMenuAnchor(null);
  }, []);

  const editor = useEditor({
    extensions: [...buildExtensions({ placeholder, members }), SlashCommand],
    content: value,
    contentType: 'markdown',
    autofocus: autoFocus ? 'end' : false,
    editable: !disabled,
    // false: editor создаётся в эффекте после маунта, а не во время рендера. В React 19
    // StrictMode immediatelyRender:true двойным рендером плодит два инстанса (первый сразу
    // destroy), и команда на разрушенном editor падала «commandManager is null».
    immediatelyRender: false,
    editorProps: {
      attributes: { class: PROSE_CLASS },
      handleDOMEvents: {
        // Правый клик внутри редактора → своё меню форматирования вместо нативного.
        contextmenu: (_view, event) => {
          const e = editorRef.current;
          if (!e || e.isDestroyed || !e.isEditable) return false; // read-only/teardown — нативное меню
          event.preventDefault();
          // Нет выделения — выделяем слово под курсором, чтобы формат применился к нему.
          selectWordAt(e, event.clientX, event.clientY);
          // Якорим у курсора; отмечаем выделение «показанным», чтобы selection-эффект
          // не перепозиционировал меню к краю выделения.
          dismissedKeyRef.current = null;
          setMenuAnchor({ x: event.clientX, top: event.clientY, bottom: event.clientY });
          return true;
        },
      },
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
          // stopPropagation — иначе native-событие всплывёт до form-level onPaste
          // (TaskDrawer) и файл прикрепится дважды.
          event.stopPropagation();
          onPasteFilesRef.current(files);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      if (e.isDestroyed) return;
      onChangeRef.current(e.getMarkdown());
    },
    onBlur: ({ editor: e }) => {
      if (!onBlurRef.current) return;
      // Откладываем на тик: focus может уйти во floating-UI редактора (bubble-меню /
      // slash / @-упоминания — портированы в body с классом `bg-popover`). В этом
      // случае blur НЕ считаем настоящим уходом из поля.
      window.setTimeout(() => {
        if (e.isDestroyed) return;
        if (e.isFocused) return;
        const activeEl = document.activeElement;
        if (activeEl && activeEl.closest('.bg-popover')) return;
        onBlurRef.current?.();
      }, 0);
    },
  });

  // Держим ref на editor актуальным для handleDOMEvents (создаётся раньше editor).
  React.useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Внешнее изменение value (AI-improve, сброс формы) → синхронизируем без эха onUpdate.
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value !== editor.getMarkdown()) {
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    }
  }, [value, editor]);

  React.useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  // Notion-style: непустое выделение → плавающее меню над ним. Дебаунс 150мс, чтобы
  // меню не дёргалось во время протяжки мышью. Пустое выделение / blur → скрыть.
  React.useEffect(() => {
    if (!editor) return;
    let timer: number | undefined;
    const compute = (): void => {
      if (editor.isDestroyed) return;
      const { state, view } = editor;
      const { from, to, empty } = state.selection;
      if (empty || !editor.isEditable || !editor.isFocused) {
        setMenuAnchor(null);
        return;
      }
      const key = `${from}-${to}`;
      if (dismissedKeyRef.current === key) return; // уже закрыли это выделение
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      setMenuAnchor({
        x: Math.min(start.left, end.left),
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
      });
    };
    const onSel = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(compute, 150);
    };
    const onBlur = (): void => {
      // Фокус мог уйти в само меню (портал в body) — не считаем это уходом.
      window.setTimeout(() => {
        if (editor.isDestroyed || editor.isFocused) return;
        const active = document.activeElement;
        if (active && active.closest('[data-format-menu]')) return;
        setMenuAnchor(null);
      }, 0);
    };
    editor.on('selectionUpdate', onSel);
    editor.on('blur', onBlur);
    return () => {
      window.clearTimeout(timer);
      editor.off('selectionUpdate', onSel);
      editor.off('blur', onBlur);
    };
  }, [editor]);

  return (
    <div className={cn('relative', className)}>
      {editor ? (
        <FloatingFormatMenu editor={editor} anchor={menuAnchor} onClose={closeMenu} />
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
