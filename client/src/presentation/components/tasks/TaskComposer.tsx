import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { FileText, Inbox, NotebookPen, Paperclip, X } from 'lucide-react';
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
import { SendTargetButton } from '@/presentation/components/tasks/SendTargetButton';
import {
  extractClipboardFiles,
  isImageMime,
} from '@/presentation/components/attachments/files';

// Цели быстрого добавления: воркеру (todo) или в черновик (backlog). Питают каретку SendTargetButton.
const QUICK_STATUS_OPTIONS = [
  { value: 'todo', label: 'Воркеру', icon: Inbox },
  { value: 'backlog', label: 'Черновик', icon: NotebookPen },
] as const;

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
  // По умолчанию — черновик (backlog): быстрое добавление кидает в бэклог, а не сразу воркеру.
  const [quickStatus, setQuickStatus] = useState<'todo' | 'backlog'>('backlog');
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
  // Floating-композер на телефоне: по умолчанию одна строка (поле + отправка), ряд доп-кнопок
  // выезжает по фокусу. На десктопе (sm+) тулбар виден всегда. Таймер откладывает сворачивание,
  // чтобы тап по кнопке тулбара успел сработать до скрытия (важно на тач — relatedTarget пуст).
  const [focused, setFocused] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openToolbar = (): void => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    setFocused(true);
  };
  const scheduleCollapse = (): void => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setFocused(false), 200);
  };

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
      setQuickStatus('backlog');
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
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasText = text.trim().length > 0;
  const canSubmit = hasText && !submitting;
  // Развёрнут, если: inline-композер (всегда), есть фокус, набран текст или есть вложения.
  const expanded = isInline || focused || hasText || pending.length > 0;
  const placeholder = isInline
    ? 'Новая задача…'
    : quickStatus === 'backlog'
      ? 'В черновик…'
      : 'Воркеру…';

  const card = (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onFocus={openToolbar}
      onBlur={(e) => {
        // Сворачиваем только когда фокус ушёл за пределы карточки (на десктопе relatedTarget
        // укажет на кнопку тулбара — тогда не сворачиваем). На тач подстрахует таймер.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleCollapse();
      }}
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

      {/* Верхний ряд: поле ввода + отправка. Всегда виден — на телефоне это и есть «одна строка». */}
      <div className="flex items-end gap-1 pr-1.5">
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
              className="block min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
            />
          </ContextMenuTrigger>
          {fmt.menuContent}
        </ContextMenu>
        <div className="flex shrink-0 items-center pb-1.5">
          <SendTargetButton
            size="sm"
            options={forcedStatus ? undefined : QUICK_STATUS_OPTIONS}
            value={quickStatus}
            onChange={setQuickStatus}
            onSend={() => void submit()}
            submitting={submitting}
            disabled={!canSubmit}
            showLabel={false}
          />
        </div>
      </div>

      {/* Ряд доп-действий. На телефоне в свёрнутом состоянии скрыт, выезжает по фокусу; на sm+ виден всегда. */}
      <div
        className={cn(
          'flex items-center gap-1.5 px-1.5 pb-2',
          isInline && 'flex-wrap',
          !expanded && 'hidden sm:flex',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="group/at size-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={submitting}
          aria-label="Прикрепить файл"
          title="Прикрепить файл (или Ctrl+V / перетащи)"
        >
          <Paperclip className="size-4 transition-transform duration-150 group-hover/at:-rotate-12 group-hover/at:scale-110" />
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
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))] z-40 flex justify-center px-3 md:bottom-4 md:px-4">
      {card}
    </div>
  );
}
