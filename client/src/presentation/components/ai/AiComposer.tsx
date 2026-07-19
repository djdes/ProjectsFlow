import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Paperclip, Sparkles, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { composeAiMessage, prepareAiAttachment, type AiAttachmentDraft } from './aiAttachments';
import { useAiActiveRunId } from './aiActiveRun';
import {
  AI_COMPOSER_MAX_LENGTH,
  clampComposerText,
  fitInsertion,
  isComposerBlank,
  normalizePastedText,
  plainTextFromEditable,
} from './composerText';

function moveCaretToEnd(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * `execCommand` формально устарел, но остаётся единственным способом положить текст
 * в contenteditable, не сломав нативный undo-стек. Ручная вставка через Range — фолбэк
 * для окружений, где команда не поддерживается.
 */
function insertPlainText(element: HTMLElement, text: string): void {
  if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    element.append(document.createTextNode(text));
    moveCaretToEnd(element);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function AiComposer({
  conversationId,
  sending,
  onSend,
  compact = false,
  autoFocus = false,
}: {
  conversationId: string | null;
  sending: boolean;
  onSend: (body: string) => Promise<void>;
  compact?: boolean;
  autoFocus?: boolean;
}): React.ReactElement {
  const { aiConversationRepository } = useContainer();
  const storageKey = `pf-ai-draft:${conversationId ?? 'new'}`;
  const [body, setBody] = useState(() => {
    try { return sessionStorage.getItem(storageKey) ?? ''; } catch { return ''; }
  });
  const [attachments, setAttachments] = useState<AiAttachmentDraft[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const editor = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const activeRunId = useAiActiveRunId(conversationId);

  const updateBody = (value: string): void => {
    setBody(value);
    try {
      if (value) sessionStorage.setItem(storageKey, value);
      else sessionStorage.removeItem(storageKey);
    } catch { /* sessionStorage unavailable */ }
  };

  // Поле не управляется React: содержимое живёт в DOM, чтобы каретка не прыгала на
  // каждый ввод. Программные изменения текста идут только через этот хелпер.
  const setEditorText = (value: string): void => {
    const element = editor.current;
    if (element) element.textContent = value;
    updateBody(value);
  };

  const syncFromEditor = (): void => {
    const element = editor.current;
    if (!element) return;
    let text = plainTextFromEditable(element);
    if (text.length > AI_COMPOSER_MAX_LENGTH) {
      text = clampComposerText(text, AI_COMPOSER_MAX_LENGTH);
      element.textContent = text;
      moveCaretToEnd(element);
    }
    updateBody(text);
  };

  useEffect(() => {
    let draft: string;
    try { draft = sessionStorage.getItem(storageKey) ?? ''; } catch { draft = ''; }
    setBody(draft);
    setAttachments([]);
    if (editor.current) editor.current.textContent = draft;
  }, [storageKey]);

  useEffect(() => {
    if (!autoFocus) return;
    const element = editor.current;
    if (!element) return;
    element.focus();
    moveCaretToEnd(element);
  }, [autoFocus]);

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const selected = [...files].slice(0, Math.max(0, 8 - attachments.length));
    if (!selected.length) return;
    try {
      const next = await Promise.all(selected.map(prepareAiAttachment));
      setAttachments((current) => [...current, ...next].slice(0, 8));
    } catch {
      toast.error('Не удалось подготовить вложение');
    }
  };

  const insertText = (value: string): void => {
    const element = editor.current;
    if (!element) return;
    const insert = fitInsertion(body, value);
    if (!insert) return;
    if (document.activeElement !== element) {
      element.focus();
      moveCaretToEnd(element);
    }
    insertPlainText(element, insert);
    syncFromEditor();
  };

  const submit = async (): Promise<void> => {
    const value = composeAiMessage(body, attachments);
    if (!value || sending) return;
    const previousBody = body;
    const previousAttachments = attachments;
    setEditorText('');
    setAttachments([]);
    try {
      await onSend(value);
      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
    } catch {
      setEditorText(previousBody);
      setAttachments(previousAttachments);
    }
  };

  const stop = async (): Promise<void> => {
    if (!conversationId || !activeRunId || cancelling) return;
    setCancelling(true);
    try {
      await aiConversationRepository.cancelRun(conversationId, activeRunId);
      toast.success('Генерация остановлена');
    } catch {
      toast.error('Не удалось остановить генерацию');
    } finally {
      setCancelling(false);
    }
  };

  const empty = isComposerBlank(body) && attachments.length === 0;

  return (
    <div className={cn(
      'rounded-2xl border bg-card shadow-[0_12px_40px_rgba(15,23,42,0.08)] transition focus-within:ring-2 focus-within:ring-ring',
      compact ? 'pb-2' : 'pb-3',
    )}>
      <div className="relative">
        {/* Плейсхолдер прячем по факту непустого DOM, а не по trim: иначе он ляжет под набранные пробелы. */}
        {body === '' && (
          <span aria-hidden="true" className="pointer-events-none absolute left-[14px] top-3 select-none truncate text-base leading-6 text-muted-foreground/70">
            О чём хотите подумать или что сделать?
          </span>
        )}
        <div
          ref={editor}
          role="textbox"
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          aria-multiline="true"
          aria-label="Сообщение для ИИ"
          className="max-h-[40vh] min-h-6 w-full overflow-y-auto whitespace-pre-wrap break-words pb-0 pl-[14px] pr-3 pt-3 text-base leading-6 outline-none"
          onInput={syncFromEditor}
          onKeyDown={(event) => {
            // IME: во время набора иероглифов Enter подтверждает вариант, а не переносит строку.
            if (event.nativeEvent.isComposing) return;
            if (event.key !== 'Enter') return;
            // Enter НЕ отправляет: отправка — только кнопкой. Перенос вставляем сами,
            // иначе браузер расщепит поле на <div>/<p> и потеряется plain-text форма.
            event.preventDefault();
            insertText('\n');
          }}
          onPaste={(event) => {
            const images = [...event.clipboardData.items]
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
              .flatMap((item) => item.getAsFile() ? [item.getAsFile()!] : []);
            if (images.length) {
              event.preventDefault();
              void addFiles(images);
              return;
            }
            // contenteditable по умолчанию втягивает HTML со стилями — вставляем только текст.
            event.preventDefault();
            insertText(normalizePastedText(event.clipboardData.getData('text/plain')));
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (event.dataTransfer.files.length) {
              void addFiles(event.dataTransfer.files);
              return;
            }
            insertText(normalizePastedText(event.dataTransfer.getData('text/plain')));
          }}
        />
      </div>
      {attachments.length > 0 && (
        <div className="mb-2 mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto px-3">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="group relative flex h-14 max-w-[220px] items-center gap-2 rounded-xl border bg-muted/30 p-1.5 pr-7">
              {attachment.previewUrl ? <img src={attachment.previewUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-background">{attachment.kind === 'text' ? <FileText className="size-4" /> : <Paperclip className="size-4" />}</span>}
              <span className="min-w-0"><span className="block truncate text-xs font-medium">{attachment.name}</span><span className="block text-[10px] text-muted-foreground">{Math.max(1, Math.round(attachment.size / 1024))} КБ</span></span>
              <button type="button" className="absolute right-1 top-1 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))} aria-label={`Убрать ${attachment.name}`}><X className="size-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 px-2.5">
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} />
        <button type="button" title="Вставьте скрин Ctrl+V или выберите файл" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => fileInput.current?.click()}><Paperclip className="size-4" /></button>
        <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground"><Sparkles className="size-3.5" /> Авто</span>
        <div className="flex-1" />
        {activeRunId ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={cancelling}
            aria-label="Остановить генерацию"
            title="Остановить генерацию"
            className="grid size-9 place-items-center rounded-full bg-foreground text-background transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={empty || sending}
            aria-label="Отправить"
            title="Отправить"
            className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground transition hover:scale-105 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:scale-100"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
