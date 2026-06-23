import { useEffect, useRef, useState } from 'react';
import { Paperclip, SendHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/domain/chat/ChatMessage';

type Props = {
  readonly onSend: (body: string, files: File[]) => Promise<void>;
  readonly replyTo: ChatMessage | null;
  readonly onCancelReply: () => void;
  readonly editing: ChatMessage | null;
  readonly onSubmitEdit: (body: string) => Promise<void>;
  readonly onCancelEdit: () => void;
};

const MAX_TEXTAREA_PX = 140;

export function ChatComposer({
  onSend,
  replyTo,
  onCancelReply,
  editing,
  onSubmitEdit,
  onCancelEdit,
}: Props): React.ReactElement {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // При входе в режим редактирования — подставляем текст и фокус.
  useEffect(() => {
    if (editing) {
      setText(editing.body);
      setFiles([]);
      taRef.current?.focus();
    }
  }, [editing]);

  // Авто-рост textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  const reset = (): void => {
    setText('');
    setFiles([]);
  };

  const submit = async (): Promise<void> => {
    const body = text.trim();
    if (editing) {
      if (!body) return;
      setBusy(true);
      try {
        await onSubmitEdit(body);
        reset();
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!body && files.length === 0) return;
    setBusy(true);
    try {
      await onSend(body, files);
      reset();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') {
      if (editing) onCancelEdit();
      else if (replyTo) onCancelReply();
    }
  };

  return (
    <div className="shrink-0 border-t bg-sidebar px-2 py-2">
      {/* контекст: ответ / редактирование */}
      {(replyTo || editing) && (
        <div className="mb-1 flex items-center gap-2 rounded-md border-l-2 border-primary/60 bg-primary/5 px-2 py-1 text-xs">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-primary/90">
              {editing ? 'Редактирование' : `Ответ ${replyTo?.authorDisplayName}`}
            </div>
            <div className="line-clamp-1 text-muted-foreground">
              {(editing ?? replyTo)?.body || 'вложение'}
            </div>
          </div>
          <button
            type="button"
            aria-label="Отменить"
            onClick={editing ? onCancelEdit : onCancelReply}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* выбранные файлы */}
      {files.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex max-w-full items-center gap-1 rounded bg-foreground/[0.05] px-1.5 py-0.5 text-xs dark:bg-white/[0.06]"
            >
              <span className="truncate">📎 {f.name}</span>
              <button
                type="button"
                aria-label="Убрать файл"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1">
        {!editing && (
          <>
            <button
              type="button"
              aria-label="Прикрепить файл"
              onClick={() => fileRef.current?.click()}
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <Paperclip className="size-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length) setFiles((prev) => [...prev, ...list].slice(0, 10));
                e.target.value = '';
              }}
            />
          </>
        )}

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={editing ? 'Изменить сообщение…' : 'Сообщение…'}
          className="min-h-8 flex-1 resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />

        <button
          type="button"
          aria-label={editing ? 'Сохранить' : 'Отправить'}
          disabled={busy || (!text.trim() && files.length === 0)}
          onClick={() => void submit()}
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-md transition-all',
            busy || (!text.trim() && files.length === 0)
              ? 'cursor-not-allowed bg-foreground/[0.06] text-muted-foreground'
              : 'bg-primary text-primary-foreground hover:opacity-90 active:scale-95',
          )}
        >
          <SendHorizontal className="size-4" />
        </button>
      </div>
    </div>
  );
}
