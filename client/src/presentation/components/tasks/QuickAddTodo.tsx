import {
  useEffect,
  useLayoutEffect,
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
import { RalphModeSelect } from './RalphMode';
import { DelegateSelect } from './DelegateSelect';
import { AiImproveButton } from '@/presentation/components/ai/AiImproveButton';
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
  // Колбэк создания задачи. QuickAddTodo передаёт выбранный status (todo | backlog).
  onCreate: (input: {
    description: string;
    status?: TaskStatus;
    ralphMode?: RalphMode;
    delegateUserId?: string | null;
    deadline?: string | null;
    priority?: TaskPriority | null;
  }) => Promise<Task>;
  // Если true — рендерим DelegateSelect (только в inbox-режиме).
  isInbox?: boolean;
  // True когда проект совместный (memberCount > 1, не inbox). Включает DelegateSelect
  // с участниками проекта.
  isShared?: boolean;
  // projectId для AI-кнопки. null = используем дефолтного AI-диспетчера
  // (для Inbox-страницы); UUID = диспетчер этого проекта. См. spec
  // 2026-05-28-ai-prompt-improvement-design.md.
  aiProjectId?: string | null;
};

// Max-height растущей textarea (~9 строк при text-sm/leading-snug).
const TEXTAREA_MAX_PX = 192;

// Floating quick-add: фиксирован снизу страницы, по центру, половина ширины.
// Textarea авто-растёт от одной строки до TEXTAREA_MAX_PX, дальше — внутренний скролл.
// Footer: 📎 слева, селектор Ralph-режима и кнопка «Отправить» — справа.
// Drop файла, Ctrl+V, Ctrl/Cmd+Enter — submit.
export function QuickAddTodo({
  onCreate,
  isInbox = false,
  isShared = false,
  aiProjectId = null,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  // Persist text across orientation changes on mobile — the browser may tear down
  // and rebuild the layout (causing React to remount), losing useState.
  const STORAGE_KEY = 'pf:quick-add-text';
  const [text, setText] = useState(() => {
    try { return sessionStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
  });
  useEffect(() => {
    try { if (text) sessionStorage.setItem(STORAGE_KEY, text); else sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, [text]);
  const [ralphMode, setRalphMode] = useState<RalphMode>('normal');
  const [quickStatus, setQuickStatus] = useState<'todo' | 'backlog'>('todo');
  const [delegateUserId, setDelegateUserId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [previewFile, setPreviewFile] = useState<PendingFile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Авто-grow: сначала сбрасываем height в auto, чтобы scrollHeight посчитался без
  // «застрявшей» высоты предыдущего рендера, потом задаём по содержимому (но не выше
  // max). useLayoutEffect — чтобы пользователь не видел кадр со старой высотой.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_PX)}px`;
  }, [text]);

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
        status: quickStatus,
        ralphMode,
        delegateUserId,
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
    } catch (err) {
      toast.error(`Не удалось создать: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Enter — перенос строки (описание может быть многострочным),
  // Ctrl/Cmd+Enter — отправка. Совпадает с паттерном description-полей в проекте.
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
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

  return (
    // pointer-events-none на внешнем wrapper'е, pointer-events-auto на самой карточке —
    // чтобы поля по бокам от floating-виджета не блокировали клики по канбану.
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3 sm:bottom-4 sm:px-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`pointer-events-auto w-full max-w-2xl overflow-hidden rounded-2xl border bg-card/95 shadow-xl backdrop-blur-md transition-colors focus-within:border-foreground/30 ${
          dragActive ? 'border-primary bg-primary/5' : ''
        }`}
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

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={submitting}
          placeholder="Добавление в Claude Opus"
          style={{ maxHeight: `${TEXTAREA_MAX_PX}px` }}
          className="block w-full resize-none overflow-y-auto bg-transparent px-3 py-2 text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
        />

        <div className="flex items-center gap-1.5 px-1.5 pb-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
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
            />
          )}
          <RalphModeSelect
            value={ralphMode}
            onChange={setRalphMode}
            disabled={submitting}
            className="!h-10 min-w-[100px] !px-2.5 !py-0 text-xs sm:min-w-[140px]"
          />
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setQuickStatus((s) => (s === 'todo' ? 'backlog' : 'todo'))}
              disabled={submitting}
              title={quickStatus === 'todo' ? 'В очередь (нажми для черновика)' : 'Черновик (нажми для очереди)'}
              className="inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
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
            <AiImproveButton
              text={text}
              projectId={aiProjectId}
              onImproved={setText}
              disabled={submitting}
              compact
            />
            <Button
              type="button"
              size="sm"
              className="h-10 gap-1.5 px-3"
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
    </div>
  );
}
