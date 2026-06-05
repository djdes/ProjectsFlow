import { useCallback, useRef } from 'react';
import type { KeyboardEvent, ReactElement, RefObject } from 'react';
import { toast } from 'sonner';
import {
  Bold,
  Calendar,
  ClipboardPaste,
  Code,
  Copy,
  Heading1,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Scissors,
  Send,
  Strikethrough,
  TextSelect,
  Type,
  Underline,
} from 'lucide-react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { copyRich } from '@/presentation/components/tasks/copyToClipboard';
import { mdToTelegramHtml } from '@/lib/telegramHtml';
import { cn } from '@/lib/utils';

// Меню форматирования + rich-копирование для текстовых полей задач (Telegram-style).
// Подключается к существующему <textarea> через его ref, БЕЗ замены поля — поэтому работает
// со всеми разнородными полями (autosize, @-mention, sessionStorage, blur-save). Все правки
// текста идут через document.execCommand('insertText') — это сохраняет нативный undo-стек
// (Ctrl+Z) и поднимает input-событие, так что контролируемый onChange поля срабатывает сам.
//
// Использование на стороне поля:
//   const fmt = useTextFieldFormatting(textareaRef);
//   <ContextMenu onOpenChange={fmt.onMenuOpenChange}>
//     <ContextMenuTrigger asChild>
//       <textarea ref={textareaRef} onKeyDown={(e) => { fmt.keyDownHandler(e);
//         if (!e.defaultPrevented) myExistingKeyDown(e); }} … />
//     </ContextMenuTrigger>
//     {fmt.menuContent}
//   </ContextMenu>

type TextareaRef = RefObject<HTMLTextAreaElement | null>;

// Запись текста в textarea с сохранением нативного undo. execCommand('insertText') заменяет
// текущее выделение и поднимает input-событие (React onChange ловит его). Фолбэк (если
// execCommand недоступен) — нативный сеттер value + ручной input-event (undo теряется).
function replaceSelection(el: HTMLTextAreaElement, text: string): void {
  el.focus();
  let ok = false;
  try {
    ok = document.execCommand('insertText', false, text);
  } catch {
    // execCommand недоступен/запрещён — упадём в фолбэк ниже.
  }
  if (ok) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(el, next);
  el.setSelectionRange(start + text.length, start + text.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Обёртка выделения парой маркеров (жирный/курсив/код/зачёркнутый/подчёркнутый).
function wrap(el: HTMLTextAreaElement, open: string, close: string): void {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const sel = el.value.slice(start, end);
  el.focus();
  el.setSelectionRange(start, end);
  replaceSelection(el, open + sel + close);
  if (sel.length === 0) {
    el.setSelectionRange(start + open.length, start + open.length);
  } else {
    el.setSelectionRange(start + open.length, start + open.length + sel.length);
  }
}

// Преобразование строк выделения (заголовок/цитата/списки). Расширяем выделение до границ
// строк, прогоняем через fn, заменяем блок одним insertText (один шаг undo).
function transformLines(
  el: HTMLTextAreaElement,
  fn: (lines: string[]) => string[],
): void {
  const value = el.value;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndNl = value.indexOf('\n', end);
  const lineEnd = lineEndNl === -1 ? value.length : lineEndNl;
  const block = fn(value.slice(lineStart, lineEnd).split('\n')).join('\n');
  el.focus();
  el.setSelectionRange(lineStart, lineEnd);
  replaceSelection(el, block);
  el.setSelectionRange(lineStart, lineStart + block.length);
}

function insertLink(el: HTMLTextAreaElement): void {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const sel = el.value.slice(start, end);
  const url = window.prompt('Вставьте ссылку', 'https://');
  if (url === null || url.trim() === '' || url.trim() === 'https://') return;
  const text = sel ? `[${sel}](${url.trim()})` : `[${url.trim()}](${url.trim()})`;
  el.focus();
  el.setSelectionRange(start, end);
  replaceSelection(el, text);
}

function insertDate(el: HTMLTextAreaElement): void {
  el.focus();
  replaceSelection(el, new Date().toLocaleDateString('ru-RU'));
}

// Конвертация markdown поля в Telegram-HTML и rich-копирование (оба флейвора в буфер).
// Экспортируется отдельно: поле описания в карточке копирует значение из state (textarea
// смонтирован только в режиме правки), а не через ref.
export async function copyMarkdownForTelegram(md: string): Promise<void> {
  if (!md.trim()) {
    toast.error('Поле пустое');
    return;
  }
  try {
    await copyRich(mdToTelegramHtml(md), md);
    toast.success('Скопировано для Telegram');
  } catch {
    toast.error('Не удалось скопировать');
  }
}

export type UseTextFieldFormatting = {
  menuContent: ReactElement;
  onMenuOpenChange: (open: boolean) => void;
  isMenuOpenRef: RefObject<boolean>;
  keyDownHandler: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  copyForTelegram: () => Promise<void>;
};

export function useTextFieldFormatting(textareaRef: TextareaRef): UseTextFieldFormatting {
  const isMenuOpenRef = useRef(false);

  const onMenuOpenChange = useCallback((open: boolean): void => {
    isMenuOpenRef.current = open;
  }, []);

  // Действия из меню выполняем после закрытия меню и возврата фокуса в textarea (Radix
  // возвращает фокус на триггер). setTimeout(0) уводит правку из-под focus-менеджмента Radix,
  // чтобы execCommand применился к сфокусированному полю.
  const defer = useCallback(
    (fn: (el: HTMLTextAreaElement) => void): void => {
      window.setTimeout(() => {
        const el = textareaRef.current;
        if (el) fn(el);
      }, 0);
    },
    [textareaRef],
  );

  // --- буфер обмена (синхронно — нужна user-activation) ---
  const copyPlain = useCallback((): void => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.selectionStart !== el.selectionEnd
      ? el.value.slice(el.selectionStart, el.selectionEnd)
      : el.value;
    if (!text) return;
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success('Скопировано'))
      .catch(() => toast.error('Не удалось скопировать'));
  }, [textareaRef]);

  const cut = useCallback((): void => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) return;
    void navigator.clipboard.writeText(el.value.slice(start, end)).catch(() => {});
    defer((node) => {
      node.focus();
      node.setSelectionRange(start, end);
      replaceSelection(node, '');
    });
  }, [textareaRef, defer]);

  // Вставка из буфера. navigator.clipboard.readText доступен в защищённом контексте по
  // user-activation (клик по пункту меню). Firefox в веб-контенте readText не даёт — тогда
  // подсказываем нативный Ctrl+V. Вставку делаем через replaceSelection (нативный undo).
  const paste = useCallback((): void => {
    const read = navigator.clipboard?.readText?.bind(navigator.clipboard);
    if (!read) {
      toast.error('Вставка недоступна — нажми Ctrl+V');
      return;
    }
    void read()
      .then((text) => {
        const node = textareaRef.current;
        if (!node || !text) return;
        node.focus();
        replaceSelection(node, text);
      })
      .catch(() => toast.error('Вставка недоступна — нажми Ctrl+V'));
  }, [textareaRef]);

  const selectAll = useCallback((): void => {
    defer((node) => {
      node.focus();
      node.select();
    });
  }, [defer]);

  const copyForTelegram = useCallback(async (): Promise<void> => {
    await copyMarkdownForTelegram(textareaRef.current?.value ?? '');
  }, [textareaRef]);

  // --- горячие клавиши (поле сфокусировано — применяем синхронно, без defer) ---
  const keyDownHandler = useCallback((e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const el = textareaRef.current;
    if (!el) return;
    const code = e.code;
    let handled = true;
    if (!e.shiftKey) {
      if (code === 'KeyB') wrap(el, '**', '**');
      else if (code === 'KeyI') wrap(el, '*', '*');
      else if (code === 'KeyU') wrap(el, '<u>', '</u>');
      else if (code === 'KeyK') insertLink(el);
      else handled = false;
    } else {
      if (code === 'KeyX') wrap(el, '~~', '~~');
      else if (code === 'Period') transformLines(el, (lines) => lines.map((l) => (l.trim() ? `> ${l}` : l)));
      else if (code === 'KeyM') wrap(el, '`', '`');
      else if (code === 'KeyD') insertDate(el);
      else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [textareaRef]);

  // --- меню (действия форматирования идут через defer) ---
  const fmtBold = useCallback(() => defer((el) => wrap(el, '**', '**')), [defer]);
  const fmtItalic = useCallback(() => defer((el) => wrap(el, '*', '*')), [defer]);
  const fmtUnderline = useCallback(() => defer((el) => wrap(el, '<u>', '</u>')), [defer]);
  const fmtStrike = useCallback(() => defer((el) => wrap(el, '~~', '~~')), [defer]);
  const fmtCode = useCallback(() => defer((el) => wrap(el, '`', '`')), [defer]);
  const fmtH1 = useCallback(
    () => defer((el) => transformLines(el, (lines) => lines.map((l, i) => (i === 0 ? `# ${l}` : l)))),
    [defer],
  );
  const fmtQuote = useCallback(
    () => defer((el) => transformLines(el, (lines) => lines.map((l) => (l.trim() ? `> ${l}` : l)))),
    [defer],
  );
  const fmtBullets = useCallback(
    () => defer((el) => transformLines(el, (lines) => lines.map((l) => (l.trim() ? `- ${l}` : l)))),
    [defer],
  );
  const fmtNumbered = useCallback(
    () =>
      defer((el) =>
        transformLines(el, (lines) => {
          let n = 0;
          return lines.map((l) => (l.trim() ? `${(n += 1)}. ${l}` : l));
        }),
      ),
    [defer],
  );
  const fmtLink = useCallback(() => defer((el) => insertLink(el)), [defer]);
  const fmtDate = useCallback(() => defer((el) => insertDate(el)), [defer]);

  const menuContent = (
    <ContextMenuContent className="w-56">
      <ContextMenuItem onSelect={copyPlain}>
        <Copy />
        Копировать
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void copyForTelegram()}>
        <Send />
        Копировать для Telegram
      </ContextMenuItem>
      <ContextMenuItem onSelect={cut}>
        <Scissors />
        Вырезать
      </ContextMenuItem>
      <ContextMenuItem onSelect={paste}>
        <ClipboardPaste />
        Вставить
      </ContextMenuItem>
      <ContextMenuItem onSelect={selectAll}>
        <TextSelect />
        Выделить всё
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Type />
          Форматирование
        </ContextMenuSubTrigger>
        <ContextMenuPortal>
          <ContextMenuSubContent className="w-60">
            <ContextMenuItem onSelect={fmtH1}>
              <Heading1 />
              Заголовок H1
            </ContextMenuItem>
            <ContextMenuItem onSelect={fmtBold}>
              <Bold />
              Жирный
              <ContextMenuShortcut>Ctrl+B</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={fmtItalic}>
              <Italic />
              Курсив
              <ContextMenuShortcut>Ctrl+I</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={fmtUnderline}>
              <Underline />
              Подчёркнутый
              <ContextMenuShortcut>Ctrl+U</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={fmtStrike}>
              <Strikethrough />
              Зачёркнутый
              <ContextMenuShortcut>Ctrl+Shift+X</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={fmtQuote}>
              <Quote />
              Цитата
              <ContextMenuShortcut>Ctrl+Shift+.</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={fmtCode}>
              <Code />
              Моноширинный
              <ContextMenuShortcut>Ctrl+Shift+M</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={fmtBullets}>
              <List />
              Маркированный список
            </ContextMenuItem>
            <ContextMenuItem onSelect={fmtNumbered}>
              <ListOrdered />
              Нумерованный список
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={fmtLink}>
              <LinkIcon />
              Добавить ссылку
              <ContextMenuShortcut>Ctrl+K</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={fmtDate}>
              <Calendar />
              Дата
              <ContextMenuShortcut>Ctrl+Shift+D</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuPortal>
      </ContextMenuSub>
    </ContextMenuContent>
  );

  return { menuContent, onMenuOpenChange, isMenuOpenRef, keyDownHandler, copyForTelegram };
}

// Компактная кнопка «Копировать для Telegram» (положение задаёт вызывающая сторона —
// в шапке поля или absolute в углу). Иконка — бумажный самолётик.
export function TelegramCopyButton({
  onCopy,
  className,
}: {
  onCopy: () => void | Promise<void>;
  className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      // mousedown.preventDefault — не уводим фокус из textarea (иначе сработает blur-save).
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => void onCopy()}
      title="Копировать для Telegram"
      aria-label="Копировать для Telegram"
      className={cn(
        'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <Send className="size-4" />
    </button>
  );
}
