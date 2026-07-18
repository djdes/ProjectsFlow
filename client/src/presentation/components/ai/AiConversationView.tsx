import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, Bot, CheckCircle2, Loader2, Sparkles, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useAiConversation } from '@/presentation/hooks/useAiConversation';
import { AiComposer } from './AiComposer';

export function AiConversationView({
  conversationId,
  compact = false,
  projectName,
}: {
  conversationId: string;
  compact?: boolean;
  projectName?: string;
}): React.ReactElement {
  const state = useAiConversation(conversationId);
  const scrollArea = useRef<HTMLDivElement | null>(null);
  const wasNearBottom = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  useEffect(() => {
    if (!projectName && state.conversation?.title) {
      document.title = `${state.conversation.title} — ProjectsFlow`;
    }
  }, [projectName, state.conversation?.title]);

  const scrollToLatest = (behavior: ScrollBehavior = 'smooth'): void => {
    const target = scrollArea.current;
    if (!target) return;
    target.scrollTo({ top: target.scrollHeight, behavior });
    wasNearBottom.current = true;
    setShowJumpToLatest(false);
  };

  useEffect(() => {
    if (!wasNearBottom.current) return;
    const frame = window.requestAnimationFrame(() => scrollToLatest(state.messages.length > 1 ? 'smooth' : 'auto'));
    return () => window.cancelAnimationFrame(frame);
    // Keep the surrounding application shell in place: only this conversation
    // viewport is allowed to scroll when a new message arrives.
  }, [state.messages]);

  if (state.loading && state.messages.length === 0) {
    return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header className={cn('flex shrink-0 items-center gap-2 border-b px-4', compact ? 'h-12' : 'h-[52px]')}>
        <div className="grid size-7 place-items-center rounded-lg bg-foreground text-background"><Sparkles className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{state.conversation?.title ?? projectName ?? 'ИИ'}</h1>
          {projectName && <p className="truncate text-[10px] text-muted-foreground">Чат проекта · {projectName}</p>}
        </div>
        {state.sending && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Думаю</span>}
      </header>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          ref={scrollArea}
          className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain"
          onScroll={(event) => {
            const target = event.currentTarget;
            const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 160;
            wasNearBottom.current = nearBottom;
            setShowJumpToLatest(!nearBottom);
          }}
        >
          <div className={cn('mx-auto flex min-h-full min-w-0 w-full flex-col px-4 py-6', compact ? 'max-w-3xl gap-4' : 'max-w-4xl gap-6')}>
          {state.messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-foreground text-background shadow-lg"><Sparkles className="size-7" /></div>
              <h2 className="text-xl font-semibold">{projectName ? `Работаем над «${projectName}»` : 'Чем помочь?'}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {projectName ? 'Обсуждайте код, интерфейс и данные проекта. Любое изменение сайта будет предложением и потребует явного подтверждения.' : 'Задайте вопрос, продумайте идею или разберите задачу. История сохранится здесь автоматически.'}
              </p>
            </div>
          ) : state.messages.map((message) => (
            <article key={message.id} className={cn('flex gap-3', message.role === 'user' && 'justify-end')}>
              {message.role !== 'user' && <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-foreground text-background"><Bot className="size-4" /></div>}
              <div className={cn('min-w-0 max-w-full overflow-hidden text-sm leading-6', message.role === 'user' ? 'max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5' : 'max-w-[calc(100%-2.5rem)] flex-1')}>
                {message.body ? (
                  <div className="prose prose-sm max-w-none overflow-x-auto break-words dark:prose-invert prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:bg-muted prose-pre:text-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                      {message.body}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-1 text-muted-foreground"><span className="flex gap-1"><i className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-.3s]" /><i className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-.15s]" /><i className="size-1.5 animate-bounce rounded-full bg-current" /></span><span className="text-xs">Формирую ответ</span></div>
                )}
                {message.role === 'assistant' && message.status === 'failed' && <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive"><AlertCircle className="size-3.5" /> Ответ не сформирован. Можно повторить запрос.</div>}
                {message.role === 'assistant' && message.status === 'completed' && <CheckCircle2 className="mt-2 size-3 text-muted-foreground/40" />}
              </div>
              {message.role === 'user' && <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><User className="size-4" /></div>}
            </article>
          ))}
          {state.error && <div className="mx-auto flex max-w-lg items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertCircle className="size-4 shrink-0" />{state.error}</div>}
          <div aria-hidden="true" />
          </div>
        </div>
        {showJumpToLatest && (
          <button
            type="button"
            onClick={() => scrollToLatest()}
            aria-label="Перейти к последнему сообщению"
            className="absolute bottom-4 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border bg-background/95 text-muted-foreground shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:text-foreground"
          >
            <ArrowDown className="size-4" />
          </button>
        )}
      </div>
      <div className="shrink-0 border-t bg-background/95 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className={cn('mx-auto', compact ? 'max-w-3xl' : 'max-w-4xl')}>
          <AiComposer conversationId={conversationId} sending={state.sending} onSend={(body) => state.send(body, projectName ? 'studio_plan' : 'chat')} compact={compact} />
          {!compact && <p className="pt-1.5 text-center text-[10px] text-muted-foreground">ИИ может ошибаться. Проверяйте важные ответы.</p>}
        </div>
      </div>
    </div>
  );
}
