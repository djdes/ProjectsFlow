import * as React from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { GripVertical } from 'lucide-react';

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

// --- Асинхронная загрузка вставленной картинки (плейсхолдер → картинка) ---------------
// Плейсхолдер-нода figureImage адресуется по uploadId: находим её позицию в актуальном
// doc и меняем attrs (progress/src) или удаляем при ошибке. Позиция ищется каждый раз
// заново — документ мог измениться, пока шла загрузка.
let uploadCounter = 0;

function findFigurePos(editor: Editor, uploadId: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'figureImage' && node.attrs.uploadId === uploadId) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function updateFigure(editor: Editor, uploadId: string, attrs: Record<string, unknown>): void {
  if (editor.isDestroyed) return;
  const pos = findFigurePos(editor, uploadId);
  if (pos === null) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

function removeFigure(editor: Editor, uploadId: string): void {
  if (editor.isDestroyed) return;
  const pos = findFigurePos(editor, uploadId);
  if (pos === null) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
}

// Императивный handle редактора — для действий извне (напр. кнопка «+ Подзадача»
// в TaskDrawer добавляет чек-лист-пункт и сразу ставит в него курсор).
export interface RichTextEditorHandle {
  /** Добавить пустой чек-лист-пункт в конец и поставить в него курсор (focus). */
  appendChecklistItem: () => void;
  /** Поставить фокус в конец содержимого. */
  focusEnd: () => void;
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
  /** Вставка НЕ-картинок из буфера (файлы-вложения). Картинки идут через onUploadImage. */
  onPasteFiles?: (files: File[]) => void;
  /**
   * Загрузка вставленной картинки как блок в позицию курсора. Возвращает URL вложения
   * (или null при ошибке). onProgress(pct) двигает прогресс-бар плейсхолдера. Если проп
   * не задан — картинки идут прежним путём через onPasteFiles.
   */
  onUploadImage?: (file: File, onProgress: (pct: number) => void) => Promise<string | null>;
}

// Notion-style WYSIWYG: форматирование видно при наборе (без сырых `**`/`#`),
// bubble-меню по выделению, slash-меню «/», @-упоминания. Хранит/отдаёт markdown.
// Прозрачно заменяет textarea (контракт value/onChange зеркалит textarea).
const PROSE_CLASS =
  'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-w-0 [overflow-wrap:anywhere] ' +
  'prose-p:my-1.5 prose-headings:mb-1 prose-headings:mt-3 prose-pre:my-2 ' +
  'prose-ul:my-1.5 prose-ol:my-1.5 prose-blockquote:my-2';

export const RichTextEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    {
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
      onUploadImage,
    },
    ref,
  ): React.ReactElement {
  // Колбэки через ref — чтобы не пересоздавать editor на каждом рендере.
  const onChangeRef = React.useRef(onChange);
  const onSubmitRef = React.useRef(onSubmit);
  const onBlurRef = React.useRef(onBlur);
  const onPasteFilesRef = React.useRef(onPasteFiles);
  const onUploadImageRef = React.useRef(onUploadImage);
  React.useEffect(() => {
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    onBlurRef.current = onBlur;
    onPasteFilesRef.current = onPasteFiles;
    onUploadImageRef.current = onUploadImage;
  });

  // Плавающее меню форматирования (по выделению И по правому клику). Якорь в
  // координатах вьюпорта; null — меню скрыто.
  const [menuAnchor, setMenuAnchor] = React.useState<FloatingAnchor | null>(null);
  // Ключ «закрытого» выделения — чтобы после Escape/действия меню не всплывало
  // снова для того же выделения (всплывёт, когда выделение сменится).
  const dismissedKeyRef = React.useRef<string | null>(null);
  // Снимок диапазона выделения на момент открытия меню. Клик по кнопке меню (портал
  // в body) уводит фокус и схлопывает выделение редактора — поэтому перед каждой
  // командой восстанавливаем диапазон из снимка.
  const savedRangeRef = React.useRef<{ from: number; to: number } | null>(null);
  // editor нужен внутри handleDOMEvents, который создаётся до объявления editor —
  // читаем через ref, чтобы не пересоздавать конфигурацию.
  const editorRef = React.useRef<Editor | null>(null);

  // Вставка картинок: на каждую — плейсхолдер-блок в позицию курсора, затем загрузка
  // с прогрессом; по завершении блок превращается в картинку, при ошибке — убирается.
  const handleImagePaste = React.useCallback((images: File[]): void => {
    const editor = editorRef.current;
    const upload = onUploadImageRef.current;
    if (!editor || editor.isDestroyed || !upload) return;
    for (const file of images) {
      const uploadId = `up-${(uploadCounter += 1)}`;
      editor
        .chain()
        .focus()
        .insertContent({ type: 'figureImage', attrs: { uploading: true, progress: 0, uploadId, src: null } })
        .run();
      void (async () => {
        try {
          const url = await upload(file, (pct) => updateFigure(editor, uploadId, { progress: pct }));
          if (url) updateFigure(editor, uploadId, { uploading: false, progress: 100, src: url });
          else removeFigure(editor, uploadId);
        } catch {
          removeFigure(editor, uploadId);
        }
      })();
    }
  }, []);

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
          // Якорим у курсора; снимок диапазона — для восстановления перед командой.
          dismissedKeyRef.current = null;
          const sel = e.state.selection;
          savedRangeRef.current = { from: sel.from, to: sel.to };
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
        if (files.length === 0) return false;
        // Картинки → inline-блок в позицию (если задан onUploadImage); остальное → вложения.
        const upload = onUploadImageRef.current;
        const images = upload ? files.filter((f) => f.type.startsWith('image/')) : [];
        const others = files.filter((f) => !images.includes(f));
        if (images.length === 0 && !onPasteFilesRef.current) return false;
        event.preventDefault();
        // stopPropagation — иначе native-событие всплывёт до form-level onPaste
        // (TaskDrawer) и файл прикрепится дважды.
        event.stopPropagation();
        if (images.length > 0) handleImagePaste(images);
        if (others.length > 0) onPasteFilesRef.current?.(others);
        return true;
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

  // Императивный API для родителя (кнопка «+ Подзадача» и т.п.). Читает editor через
  // editorRef, поэтому handle стабилен (deps []).
  React.useImperativeHandle(
    ref,
    () => ({
      focusEnd(): void {
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return;
        ed.chain().focus('end').run();
      },
      appendChecklistItem(): void {
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed || !ed.isEditable) return;
        ed.chain()
          .focus()
          .command(({ tr, state, dispatch }) => {
            const { schema, doc } = state;
            const taskItemType = schema.nodes['taskItem'];
            const taskListType = schema.nodes['taskList'];
            const paragraphType = schema.nodes['paragraph'];
            if (!taskItemType || !taskListType || !paragraphType) return false;
            if (!dispatch) return true;

            const item = taskItemType.create({ checked: false }, paragraphType.create());

            // Если содержимое уже заканчивается чек-листом — добавляем пункт ВНУТРЬ него,
            // вплотную к предыдущему (без нового блока-списка и его блочного зазора).
            // Хвостовой пустой параграф (tiptap часто держит его в конце) игнорируем.
            let lastListPos = -1;
            let lastListSize = 0;
            doc.forEach((node, offset) => {
              if (node.type === taskListType) {
                lastListPos = offset;
                lastListSize = node.nodeSize;
              }
            });
            const lastChild = doc.lastChild;
            const trailingEmptyPara =
              lastChild != null && lastChild.type === paragraphType && lastChild.content.size === 0
                ? lastChild.nodeSize
                : 0;
            const listIsTrailing =
              lastListPos >= 0 && lastListPos + lastListSize === doc.content.size - trailingEmptyPara;

            if (listIsTrailing) {
              // Вставка перед закрывающим токеном списка → пункт становится последним.
              const insertPos = lastListPos + lastListSize - 1;
              tr.insert(insertPos, item);
              // Курсор внутрь пустого параграфа нового пункта: item(+1) para(+1).
              const cursor = Math.min(insertPos + 2, tr.doc.content.size);
              tr.setSelection(TextSelection.create(tr.doc, cursor));
            } else {
              const list = taskListType.create(null, item);
              const endPos = doc.content.size;
              tr.insert(endPos, list);
              // Курсор внутрь пустого параграфа нового пункта: list(+1) item(+1) para(+1).
              const cursor = Math.min(endPos + 3, tr.doc.content.size);
              tr.setSelection(TextSelection.create(tr.doc, cursor));
            }
            tr.scrollIntoView();
            return true;
          })
          .run();
      },
    }),
    [],
  );

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
  // меню не дёргалось во время протяжки мышью. Закрытие — по схлопыванию выделения
  // ИЛИ клику вне меню и редактора (НЕ по blur: фокус уходит в портал-меню при работе
  // с цветом/преобразованием, и blur-закрытие убивало бы меню в момент клика).
  React.useEffect(() => {
    if (!editor) return;
    let timer: number | undefined;
    const compute = (): void => {
      if (editor.isDestroyed) return;
      const { state, view } = editor;
      const { from, to, empty } = state.selection;
      // Блочное выделение (NodeSelection) создаёт drag-handle при захвате блока —
      // меню форматирования тут не нужно (иначе всплывает при перетаскивании).
      if (state.selection instanceof NodeSelection) {
        dismissedKeyRef.current = null;
        setMenuAnchor(null);
        return;
      }
      if (empty || !editor.isEditable) {
        // Выделение схлопнулось из-за клика по самому меню (фокус ушёл в портал) —
        // не закрываем, меню живёт по снимку диапазона. Иначе (клик/стрелки в
        // редакторе) — закрываем.
        if (document.activeElement?.closest('[data-format-menu]')) return;
        dismissedKeyRef.current = null;
        setMenuAnchor(null);
        return;
      }
      const key = `${from}-${to}`;
      if (dismissedKeyRef.current === key) return; // уже закрыли это выделение
      savedRangeRef.current = { from, to };
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
    // pointerdown по самому меню — игнорируем (работа с меню). Новый жест в редакторе —
    // снимаем «закрытость» (чтобы повторное выделение того же диапазона снова открыло
    // меню); схлопывание выделения закроет меню через compute. Клик строго вне меню и
    // редактора — закрываем сразу.
    const onPointerDown = (ev: PointerEvent): void => {
      const t = ev.target as Node | null;
      if (!t) return;
      const el = t instanceof Element ? t : t.parentElement;
      if (el && el.closest('[data-format-menu]')) return;
      if (editor.view?.dom.contains(t)) {
        dismissedKeyRef.current = null;
        return;
      }
      closeMenu();
    };
    editor.on('selectionUpdate', onSel);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.clearTimeout(timer);
      editor.off('selectionUpdate', onSel);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [editor, closeMenu]);

  return (
    <div className={cn('relative', className)}>
      {editor ? (
        <FloatingFormatMenu
          editor={editor}
          anchor={menuAnchor}
          onClose={closeMenu}
          getRange={() => savedRangeRef.current}
        />
      ) : null}
      {/* Ручка-«6 точек» слева при наведении на блок (абзац/картинка) → drag-reorder.
          Только в описании (не в комментариях), в редактируемом режиме. */}
      {editor && variant === 'description' && !disabled ? (
        <DragHandle editor={editor} computePositionConfig={{ placement: 'left-start' }}>
          <button
            type="button"
            aria-label="Переместить блок"
            className="flex h-6 w-4 cursor-grab items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        </DragHandle>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
  },
);
