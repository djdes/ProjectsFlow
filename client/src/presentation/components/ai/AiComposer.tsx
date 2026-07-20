import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Paperclip, Sparkles, Square, SquareMousePointer, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { AiSelectionRef } from '@/domain/ai-chat/AiSelectionRef';
import { AiSelectionChip } from './AiSelectionChip';
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

/**
 * Режим композера. `discuss` — обычное сообщение в чат (для проекта это read-only
 * рассуждение, mode=studio_plan). `build` — правка сайта: промпт уходит тем же путём,
 * что и из правой панели, и всегда привязан к выделенной зоне.
 */
export type AiComposerMode = 'discuss' | 'build';

/** Тумблер «обсудить ↔ править». Есть только в студии проекта; без него композер прежний. */
export type AiComposerModeSwitch = {
  readonly mode: AiComposerMode;
  readonly onChange: (mode: AiComposerMode) => void;
  // Править можно только выделенную в предпросмотре зону: job визуального редактора
  // без элемента не существует. Нет зоны — тумблер выключен, а не «сломан при отправке».
  readonly buildEnabled: boolean;
};

/** Программное заполнение поля (пресет на пустом чате, чип-подсказка). Токен — нонс. */
export type AiComposerInsert = {
  readonly text: string;
  readonly token: number;
  readonly focus?: boolean;
};

const PLACEHOLDER: Record<AiComposerMode, string> = {
  discuss: 'Что обсудим по проекту?',
  build: 'Что изменить в выделенной зоне?',
};

export function AiComposer({
  conversationId,
  sending,
  onSend,
  compact = false,
  autoFocus = false,
  modeSwitch,
  selection,
  onOpenSelection,
  insert,
}: {
  conversationId: string | null;
  sending: boolean;
  onSend: (body: string, mode: AiComposerMode) => Promise<void>;
  compact?: boolean;
  autoFocus?: boolean;
  modeSwitch?: AiComposerModeSwitch;
  // Зона, выделенная в предпросмотре прямо сейчас. У base44 композер о выделении молчит
  // и узнать о нём можно только по отправленному пузырю — здесь по прямому требованию
  // владельца зона видна ДО отправки.
  selection?: AiSelectionRef | null;
  onOpenSelection?: (selection: AiSelectionRef) => void;
  insert?: AiComposerInsert | null;
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
  const insertTokenRef = useRef<number | null>(null);
  const mode = modeSwitch?.mode ?? 'discuss';

  const updateBody = useCallback((value: string): void => {
    setBody(value);
    try {
      if (value) sessionStorage.setItem(storageKey, value);
      else sessionStorage.removeItem(storageKey);
    } catch { /* sessionStorage unavailable */ }
  }, [storageKey]);

  // Поле не управляется React: содержимое живёт в DOM, чтобы каретка не прыгала на
  // каждый ввод. Программные изменения текста идут только через этот хелпер.
  const setEditorText = useCallback((value: string): void => {
    const element = editor.current;
    if (element) element.textContent = value;
    updateBody(value);
  }, [updateBody]);

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

  // Заполнение поля снаружи. Реагируем на токен, а не на текст: повторный клик по тому
  // же чипу-подсказке обязан сработать снова. Композер при этом НЕ перемонтируется —
  // иначе слетал бы фокус, а в референсе после клика по чипу он остаётся на чипе.
  useEffect(() => {
    if (!insert || insertTokenRef.current === insert.token) return;
    insertTokenRef.current = insert.token;
    setEditorText(insert.text);
    if (!insert.focus) return;
    const element = editor.current;
    if (!element) return;
    element.focus();
    moveCaretToEnd(element);
  }, [insert, setEditorText]);

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
      await onSend(value, mode);
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
      {/* Выделенная зона — над полем ввода, как бейдж в отправленном пузыре. Показываем
          её независимо от режима: выделение принадлежит рабочей области, а не режиму,
          и его появление/исчезновение не должно выглядеть как побочный эффект тумблера. */}
      {selection && (
        <div className="flex min-w-0 items-center gap-2 px-3 pt-2.5">
          <AiSelectionChip selection={selection} onOpen={onOpenSelection} />
          <span className="min-w-0 truncate text-[11px] leading-4 text-muted-foreground">Выделенная зона</span>
        </div>
      )}
      <div className="relative">
        {/* Плейсхолдер прячем по факту непустого DOM, а не по trim: иначе он ляжет под набранные пробелы. */}
        {body === '' && (
          <span aria-hidden="true" className="pointer-events-none absolute left-[14px] top-3 select-none truncate text-base leading-6 text-muted-foreground/70">
            {modeSwitch ? PLACEHOLDER[mode] : 'О чём хотите подумать или что сделать?'}
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
        {/* Чистый тумблер: коробка кнопки не меняется, меняются только заливка/цвет и
            плейсхолдер поля. Черновик и фокус остаются на месте — поле не перемонтируется. */}
        {modeSwitch && (
          <button
            type="button"
            aria-pressed={modeSwitch.mode === 'build'}
            disabled={!modeSwitch.buildEnabled}
            title={modeSwitch.buildEnabled
              ? 'Правка выделенной зоны сайта вместо обсуждения'
              : 'Выделите зону в предпросмотре — правка уйдёт в неё'}
            onClick={() => modeSwitch.onChange(modeSwitch.mode === 'build' ? 'discuss' : 'build')}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-[5px] rounded-md py-0 pl-1.5 pr-2 text-xs font-medium leading-4',
              'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
              modeSwitch.mode === 'build'
                ? 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            <SquareMousePointer className="size-4 shrink-0" aria-hidden />
            Правка
          </button>
        )}
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
