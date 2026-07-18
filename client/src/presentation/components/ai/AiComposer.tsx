import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Plus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const storageKey = `pf-ai-draft:${conversationId ?? 'new'}`;
  const [body, setBody] = useState(() => {
    try { return sessionStorage.getItem(storageKey) ?? ''; } catch { return ''; }
  });
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try { setBody(sessionStorage.getItem(storageKey) ?? ''); } catch { setBody(''); }
  }, [storageKey]);

  const updateBody = (value: string): void => {
    setBody(value);
    try {
      if (value) sessionStorage.setItem(storageKey, value);
      else sessionStorage.removeItem(storageKey);
    } catch { /* sessionStorage unavailable */ }
  };

  const submit = async (): Promise<void> => {
    const value = body.trim();
    if (!value || sending) return;
    updateBody('');
    try {
      await onSend(value);
      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
    } catch {
      updateBody(value);
    }
  };

  return (
    <div className={cn('rounded-2xl border bg-card shadow-[0_12px_40px_rgba(15,23,42,0.08)]', compact ? 'p-2' : 'p-3')}>
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={body}
        onChange={(event) => updateBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        rows={compact ? 2 : 3}
        maxLength={50_000}
        placeholder="О чём хотите подумать или что сделать?"
        aria-label="Сообщение для ИИ"
        className="block max-h-48 min-h-12 w-full resize-none bg-transparent px-1 py-1.5 text-sm leading-6 outline-none placeholder:text-muted-foreground/70"
      />
      <div className="mt-2 flex items-center gap-1.5">
        <button type="button" disabled title="Вложения появятся в следующем обновлении" className="grid size-8 place-items-center rounded-lg text-muted-foreground opacity-60">
          <Plus className="size-4" />
        </button>
        <button type="button" disabled title="Прикрепить файл" className="grid size-8 place-items-center rounded-lg text-muted-foreground opacity-60">
          <Paperclip className="size-4" />
        </button>
        <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" /> Авто
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!body.trim() || sending}
          aria-label={sending ? 'ИИ отвечает' : 'Отправить'}
          className="grid size-9 place-items-center rounded-full bg-foreground text-background transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:scale-100"
        >
          {sending ? <span className="size-3 animate-pulse rounded-full bg-background" /> : <ArrowUp className="size-4" />}
        </button>
      </div>
    </div>
  );
}
