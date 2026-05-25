import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { FileText, Loader2, Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { RalphMode, Task } from '@/domain/task/Task';
import { useContainer } from '@/infrastructure/di/container';
import { RalphModeSelect } from './RalphMode';
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
  // Колбэк создания задачи. KanbanBoard оборачивает useTasks.create с фиксированным
  // status: 'todo', поэтому новые карточки всегда приземляются в колонку TODO.
  onCreate: (input: { description: string; ralphMode?: RalphMode }) => Promise<Task>;
};

// Compact quick-add для TODO. Половина ширины, по центру. Textarea + (Ctrl+V или drag)
// файлы, ниже — селектор Ralph-режима слева и Отправить справа. Ctrl/Cmd+Enter — submit.
export function QuickAddTodo({ onCreate }: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [text, setText] = useState('');
  const [ralphMode, setRalphMode] = useState<RalphMode>('normal');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const task = await onCreate({ description: trimmed, ralphMode });
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
      setRalphMode('normal');
    } catch (err) {
      toast.error(`Не удалось создать: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Enter — перенос строки (описание задачи может быть многострочным),
  // Ctrl/Cmd+Enter — отправка. Совпадает с принятым в проекте паттерном для description-полей.
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const canSubmit = text.trim().length > 0 && !submitting;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`overflow-hidden rounded-lg border bg-card shadow-sm transition-colors focus-within:border-foreground/30 ${
          dragActive ? 'border-primary bg-primary/5' : ''
        }`}
      >
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b bg-muted/40 px-3 py-2">
            {pending.map((pf) => (
              <span
                key={pf.id}
                className="inline-flex items-center gap-1.5 rounded border bg-background py-0.5 pl-1.5 pr-1 text-[11px]"
                title={pf.file.name}
              >
                {pf.previewUrl ? (
                  <img src={pf.previewUrl} alt="" className="size-4 rounded object-cover" />
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

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={submitting}
          placeholder="Быстрое добавление TODO для автовыполнения задачи в Claude Code/Opus"
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
        />

        <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-2 py-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
              aria-label="Прикрепить файл"
              title="Прикрепить файл (или Ctrl+V / перетащи)"
            >
              <Paperclip className="size-3.5" />
            </Button>
            <RalphModeSelect
              value={ralphMode}
              onChange={setRalphMode}
              disabled={submitting}
              className="!h-7 min-w-[180px] !px-2 !py-0 text-xs"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={!canSubmit}
            title="Ctrl+Enter"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Отправить
          </Button>
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
