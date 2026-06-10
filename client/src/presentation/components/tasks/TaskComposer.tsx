import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { FileText, Inbox, Loader2, NotebookPen, Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import type { RalphMode, Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { useContainer } from '@/infrastructure/di/container';
import { cn } from '@/lib/utils';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useTextFieldFormatting } from '@/presentation/hooks/useTextFieldFormatting';
import { useAutoGrowTextarea } from '@/presentation/hooks/useAutoGrowTextarea';
import { RalphModeSelect } from './RalphMode';
import { DelegateSelect } from './DelegateSelect';
import { PrioritySelect } from './PrioritySelect';
import { DeadlinePicker } from './DeadlinePicker';
import { AiComposeDialog } from '@/presentation/components/ai/AiComposeDialog';
import {
  extractClipboardFiles,
  isImageMime,
} from '@/presentation/components/attachments/files';

type PendingFile = {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string;
};

type Props = {
  // Колбэк создания задачи. Передаёт выбранный/форсированный status.
  onCreate: (input: {
    description: string;
    status?: TaskStatus;
    ralphMode?: RalphMode;
    delegateUserId?: string | null;
    deadline?: string | null;
    priority?: TaskPriority | null;
  }) => Promise<Task>;
  // 'floating' — глобальный виджет (fixed снизу страницы). 'inline' — встроенный в колонку.
  variant: 'floating' | 'inline';
  // Если задан — задача всегда создаётся в этом статусе, тоггл todo/backlog скрыт
  // (inline-композер в конкретной колонке).
  forcedStatus?: TaskStatus;
  // Inbox-режим: показываем DelegateSelect.
  isInbox?: boolean;
  // Совместный проект (memberCount > 1, не inbox): DelegateSelect с участниками проекта.
  isShared?: boolean;
  // projectId для AI-кнопки. null = дефолтный AI-диспетчер (Inbox).
  aiProjectId?: string | null;
  // Автофокус на textarea при монтировании (inline-композер).
  autoFocus?: boolean;
  // Кнопка-крестик закрытия (только inline). Если не задана — крестик не рисуем.
  onClose?: () => void;
  // Ключ sessionStorage для черновика текста. У каждого inline-композера свой, чтобы
  // черновики разных колонок и floating-виджета не затирали друг друга.
  storageKey?: string;
};

// Композер задачи: авто-grow textarea, drop/paste/Ctrl+V файлов, Ralph-режим, делегирование,
// AI-improve, Ctrl/Cmd+Enter — submit. Питает и floating-виджет, и inline-композер колонки.
export function TaskComposer({
  onCreate,
  variant,
  forcedStatus,
  isInbox = false,
  isShared = false,
  aiProjectId = null,
  autoFocus = false,
  onClose,
  storageKey,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const isInline = variant === 'inline';
  // Persist text across orientation changes on mobile (браузер может пересоздать layout).
  const STORAGE_KEY = storageKey ?? 'pf:quick-add-text';
  const [text, setText] = useState(() => {
    try { return sessionStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
  });
  useEffect(() => {
    try { if (text) sessionStorage.setItem(STORAGE_KEY, text); else sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, [text, STORAGE_KEY]);
  const [ralphMode, setRalphMode] = useState<RalphMode>('normal');
  const [quickStatus, setQuickStatus] = useState<'todo' | 'backlog'>('todo');
  const [delegateUserId, setDelegateUserId] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [previewFile, setPreviewFile] = useState<PendingFile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fmt = useTextFieldFormatting(textareaRef);

  // Авто-рост до 12 строк (site-wide правило), дальше внутренний скролл.
  useAutoGrowTextarea(textareaRef, text, { minRows: 1 });

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const addFiles = (raw: FileList | File[]): void => {
    const list = Array.from(raw);
    if (list.length === 0) return;
    setPending((prev) => [
      ...prev,
      ...list.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: isImageMime(file.type) ? URL.createObjectURL(file) : '',
      })),
    ]);
  };

  const removeFile = (id: string): void => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = extractClipboardFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const submit = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const task = await onCreate({
        description: trimmed,
        status: forcedStatus ?? quickStatus,
        ralphMode,
        delegateUserId,
        priority,
        deadline,
      });
      if (pending.length > 0) {
        let ok = 0;
        for (const pf of pending) {
          try {
            await taskRepository.uploadAttachment(task.projectId, task.id, pf.file);
            ok += 1;
          } catch (err) {
            toast.error(`Не удалось загрузить ${pf.file.name}: ${(err as Error).message}`);
          }
        }
        if (ok > 0) {
          toast.success(
            ok === pending.length
              ? 'Файлы прикреплены'
              : `Прикреплено ${ok} из ${pending.length}`,
          );
        }
      }
      pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      setPending([]);
      setText('');
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      setRalphMode('normal');
      setQuickStatus('todo');
      setDelegateUserId(null);
      setPriority(null);
      setDeadline(null);
    } catch (err) {
      toast.error(`Не удалось создать: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Enter — перенос строки, Ctrl/Cmd+Enter — отправка. Esc (inline) — закрыть пустой композер.
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && isInline && onClose && text.trim().length === 0) {
      e.preventDefault();
      onClose();
    }
  };

  // Чистим Blob URL'ы pending-файлов при размонтировании.
  useEffect(() => {
    return () => {
      pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = text.trim().length > 0 && !submitting;
  const placeholder = isInline ? 'Новая задача…' : 'Добавление в Claude Opus';

  const card = (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'w-full overflow-hidden border bg-card transition-colors focus-within:border-foreground/30',
        isInline
          ? 'rounded-lg shadow-sm'
          : 'pointer-events-auto max-w-2xl rounded-2xl bg-card/95 shadow-lg backdrop-blur-md',
        dragActive ? 'border-primary bg-primary/5' : '',
      )}
    >
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b bg-muted/30 px-2.5 py-1.5">
          {pending.map((pf) => (
            <span
              key={pf.id}
              className="inline-flex items-center gap-1.5 rounded border bg-background py-0.5 pl-1.5 pr-1 text-[11px]"
              title={pf.file.name}
            >
              {pf.previewUrl ? (
                <button
                  type="button"
                  onClick={() => setPreviewFile(pf)}
                  className="cursor-pointer"
                >
                  <img src={pf.previewUrl} alt="" className="size-4 rounded object-cover" />
                </button>
              ) : (
                <FileText className="size-3.5 text-muted-foreground" />
              )}
              <span className="max-w-[140px] truncate">{pf.file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(pf.id)}
                className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-destructive hover:text-white"
                aria-label="Убрать"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {previewFile && (
        <Dialog open onOpenChange={() => setPreviewFile(null)}>
          <DialogContent className="grid max-h-[90dvh] max-w-4xl gap-0 overflow-hidden p-0">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <p className="truncate text-sm font-medium">{previewFile.file.name}</p>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setPreviewFile(null)} aria-label="Закрыть">
                <X className="size-4" />
              </Button>
            </div>
            <div className="grid place-items-center overflow-auto bg-muted/30 p-2 sm:p-4">
              <img
                src={previewFile.previewUrl}
                alt={previewFile.file.name}
                className="max-h-[75dvh] max-w-full object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      <ContextMenu onOpenChange={fmt.onMenuOpenChange}>
        <ContextMenuTrigger asChild>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              fmt.keyDownHandler(e);
              if (!e.defaultPrevented) handleKeyDown(e);
            }}
            rows={1}
            disabled={submitting}
            placeholder={placeholder}
            className="block w-full resize-none bg-transparent px-3 py-2 text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
          />
        </ContextMenuTrigger>
        {fmt.menuContent}
      </ContextMenu>

      <div className={cn('flex items-center gap-1.5 px-1.5 pb-2', isInline && 'flex-wrap')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={submitting}
          aria-label="Прикрепить файл"
          title="Прикрепить файл (или Ctrl+V / перетащи)"
        >
          <Paperclip className="size-4" />
        </Button>
        {(isInbox || isShared) && (
          <DelegateSelect
            value={delegateUserId}
            onChange={setDelegateUserId}
            disabled={submitting}
            projectId={isShared && aiProjectId ? aiProjectId : undefined}
            className="size-9"
          />
        )}
        <RalphModeSelect
          value={ralphMode}
          onChange={setRalphMode}
          disabled={submitting}
          variant="ghost"
          iconOnly
          className="!size-9 shrink-0 !p-0"
        />
        <PrioritySelect
          value={priority}
          onChange={setPriority}
          disabled={submitting}
          iconOnly
          className="size-9"
        />
        <DeadlinePicker
          value={deadline}
          onChange={setDeadline}
          disabled={submitting}
          iconOnly
          className={cn('h-9', deadline === null ? 'w-9 px-0' : 'px-2')}
        />
        <div className="ml-auto flex items-center gap-1.5">
          {!forcedStatus && (
            <button
              type="button"
              onClick={() => setQuickStatus((s) => (s === 'todo' ? 'backlog' : 'todo'))}
              disabled={submitting}
              title={quickStatus === 'todo' ? 'В очередь (нажми для черновика)' : 'Черновик (нажми для очереди)'}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {quickStatus === 'todo' ? (
                <>
                  <Inbox className="size-4" />
                  <span className="hidden sm:inline">В очередь</span>
                </>
              ) : (
                <>
                  <NotebookPen className="size-4" />
                  <span className="hidden sm:inline">Черновик</span>
                </>
              )}
            </button>
          )}
          <AiComposeDialog
            text={text}
            projectId={aiProjectId}
            onImproved={setText}
            onDistributed={() => {
              // Задачи распределены и созданы напрямую — очищаем композер.
              setText('');
              try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
            }}
            ralphMode={ralphMode}
            disabled={submitting}
            compact
          />
          {isInline && onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              disabled={submitting}
              aria-label="Закрыть"
              title="Закрыть (Esc)"
            >
              <X className="size-4" />
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-9 gap-1.5 px-3"
            onClick={() => void submit()}
            disabled={!canSubmit}
            title="Ctrl+Enter"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            <span className="hidden sm:inline">Отправить</span>
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );

  if (isInline) return card;

  // Floating: pointer-events-none на внешнем wrapper'е, pointer-events-auto на самой карточке —
  // чтобы поля по бокам не блокировали клики по канбану. На mobile (<md) приподнят
  // над нижним таб-баром (h-14, см. AppShell MobileBottomNav).
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[4.5rem] z-40 flex justify-center px-3 md:bottom-4 md:px-4">
      {card}
    </div>
  );
}
