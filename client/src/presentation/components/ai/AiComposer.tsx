import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Paperclip, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { composeAiMessage, prepareAiAttachment, type AiAttachmentDraft } from './aiAttachments';

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
  const [attachments, setAttachments] = useState<AiAttachmentDraft[]>([]);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try { setBody(sessionStorage.getItem(storageKey) ?? ''); } catch { setBody(''); }
    setAttachments([]);
  }, [storageKey]);

  const updateBody = (value: string): void => {
    setBody(value);
    try {
      if (value) sessionStorage.setItem(storageKey, value);
      else sessionStorage.removeItem(storageKey);
    } catch { /* sessionStorage unavailable */ }
  };

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

  const submit = async (): Promise<void> => {
    const value = composeAiMessage(body, attachments);
    if (!value || sending) return;
    const previousBody = body;
    const previousAttachments = attachments;
    updateBody('');
    setAttachments([]);
    try {
      await onSend(value);
      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
    } catch {
      updateBody(previousBody);
      setAttachments(previousAttachments);
    }
  };

  return (
    <div className={cn('rounded-2xl border bg-card shadow-[0_12px_40px_rgba(15,23,42,0.08)]', compact ? 'p-2' : 'p-3')}>
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={body}
        onChange={(event) => updateBody(event.target.value)}
        onPaste={(event) => {
          const images = [...event.clipboardData.items]
            .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
            .flatMap((item) => item.getAsFile() ? [item.getAsFile()!] : []);
          if (!images.length) return;
          event.preventDefault();
          void addFiles(images);
        }}
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
      {attachments.length > 0 && (
        <div className="mb-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto px-1">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="group relative flex h-14 max-w-[220px] items-center gap-2 rounded-xl border bg-muted/30 p-1.5 pr-7">
              {attachment.previewUrl ? <img src={attachment.previewUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-background">{attachment.kind === 'text' ? <FileText className="size-4" /> : <Paperclip className="size-4" />}</span>}
              <span className="min-w-0"><span className="block truncate text-xs font-medium">{attachment.name}</span><span className="block text-[10px] text-muted-foreground">{Math.max(1, Math.round(attachment.size / 1024))} КБ</span></span>
              <button type="button" className="absolute right-1 top-1 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))} aria-label={`Убрать ${attachment.name}`}><X className="size-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} />
        <button type="button" title="Вставьте скрин Ctrl+V или выберите файл" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => fileInput.current?.click()}><Paperclip className="size-4" /></button>
        <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground"><Sparkles className="size-3.5" /> Авто</span>
        <div className="flex-1" />
        <button type="button" onClick={() => void submit()} disabled={(!body.trim() && attachments.length === 0) || sending} aria-label={sending ? 'ИИ отвечает' : 'Отправить'} className="grid size-9 place-items-center rounded-full bg-foreground text-background transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:scale-100">
          {sending ? <span className="size-3 animate-pulse rounded-full bg-background" /> : <ArrowUp className="size-4" />}
        </button>
      </div>
    </div>
  );
}
