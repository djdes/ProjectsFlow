import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Archive, ArrowDown, BookOpen, Bot, CheckCircle2, ChevronDown, ChevronRight, Copy, FileOutput, FileText, Image, Loader2, MoreHorizontal, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Plus, RefreshCw, Share2, Sparkles, ThumbsDown, ThumbsUp, Trash2, User, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useAiConversation } from '@/presentation/hooks/useAiConversation';
import { useAiConversations, announceAiConversationsChanged } from '@/presentation/hooks/useAiConversations';
import { useContainer } from '@/infrastructure/di/container';
import type { AiConversation, AiMessage } from '@/domain/ai-chat/AiConversation';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AiComposer } from './AiComposer';
import { extractAiAttachments } from './aiAttachments';
import { AiActionPlanCard, extractAiActionPlan } from './AiActionPlanCard';

export function AiConversationView({
  conversationId,
  compact = false,
  projectName,
  projectId,
  hideHeader = false,
}: {
  conversationId: string;
  compact?: boolean;
  projectName?: string;
  projectId?: string;
  hideHeader?: boolean;
}): React.ReactElement {
  const state = useAiConversation(conversationId);
  const scrollArea = useRef<HTMLDivElement | null>(null);
  const wasNearBottom = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280);
  const personalWorkspace = !projectName && !hideHeader && !compact;

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
      {!hideHeader && (personalWorkspace ? (
        <AiConversationHeader
          conversation={state.conversation}
          sending={state.sending}
          detailsOpen={detailsOpen}
          onDetailsChange={setDetailsOpen}
          onConversationUpdated={state.setConversation}
        />
      ) : (
        <header className={cn('flex shrink-0 items-center gap-2 border-b px-4', compact ? 'h-12' : 'h-[52px]')}>
          <div className="grid size-7 place-items-center rounded-lg bg-foreground text-background"><Sparkles className="size-4" /></div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{state.conversation?.title ?? projectName ?? 'ИИ'}</h1>
            {projectName && <p className="truncate text-[10px] text-muted-foreground">Чат проекта · {projectName}</p>}
          </div>
          {state.sending && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Думаю</span>}
        </header>
      ))}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                ) : state.messages.map((message, index) => {
                  const previousUser = [...state.messages.slice(0, index)].reverse().find((item) => item.role === 'user');
                  return (
                    <ConversationMessage
                      key={message.id}
                      message={message}
                      previousUserBody={previousUser?.body}
                      sending={state.sending}
                      onRetry={(body) => state.send(body, projectName ? 'studio_plan' : 'chat')}
                      projectId={projectId}
                    />
                  );
                })}
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
        {personalWorkspace && detailsOpen && <AgentDetails messages={state.messages} />}
      </div>
    </div>
  );
}

function AiConversationHeader({
  conversation,
  sending,
  detailsOpen,
  onDetailsChange,
  onConversationUpdated,
}: {
  conversation: AiConversation | null;
  sending: boolean;
  detailsOpen: boolean;
  onDetailsChange: (open: boolean) => void;
  onConversationUpdated: (conversation: AiConversation | null) => void;
}): React.ReactElement {
  const { aiConversationRepository } = useContainer();
  const { items } = useAiConversations();
  const navigate = useNavigate();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const personalItems = items.filter((item) => item.kind === 'personal').slice(0, 16);

  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await aiConversationRepository.create({ kind: 'personal', title: 'Новый чат' });
      announceAiConversationsChanged();
      navigate(`/ai/c/${next.id}`);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Ссылка на чат скопирована');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  };

  const rename = async (): Promise<void> => {
    if (!conversation || !title.trim() || busy) return;
    setBusy(true);
    try {
      const updated = await aiConversationRepository.update(conversation.id, { title: title.trim(), expectedVersion: conversation.version });
      onConversationUpdated(updated);
      announceAiConversationsChanged();
      setRenameOpen(false);
    } catch {
      toast.error('Не удалось переименовать чат');
    } finally {
      setBusy(false);
    }
  };

  const archive = async (): Promise<void> => {
    if (!conversation || busy) return;
    setBusy(true);
    try {
      await aiConversationRepository.update(conversation.id, { archived: true, expectedVersion: conversation.version });
      announceAiConversationsChanged();
      navigate('/ai');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!conversation || busy) return;
    setBusy(true);
    try {
      await aiConversationRepository.remove(conversation.id);
      announceAiConversationsChanged();
      navigate('/ai');
    } catch {
      toast.error('Не удалось удалить чат');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-2 sm:px-3">
        <button type="button" onClick={() => navigate('/ai')} className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background" aria-label="Открыть главную ProjectsFlow ИИ"><Sparkles className="size-4" /></button>
        <button type="button" onClick={() => navigate('/ai')} className="hidden rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-hover sm:inline-flex">ProjectsFlow ИИ</button>
        <span className="text-muted-foreground">/</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex min-w-0 max-w-[42vw] items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-hover" aria-label="История ИИ-чатов">
              <span className="truncate font-medium">{conversation?.title ?? 'Чат'}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Недавние чаты</p>
            {personalItems.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => navigate(`/ai/c/${item.id}`)} className={cn(item.id === conversation?.id && 'bg-muted')}>
                <Sparkles className="size-4" /><span className="min-w-0 flex-1 truncate">{item.title}</span>{item.id === conversation?.id && <CheckCircle2 className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        {sending && <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex"><Loader2 className="size-3 animate-spin" /> Думаю</span>}
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Поделиться чатом" onClick={() => void copyLink()}><Share2 className="size-4" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Начать новый чат" disabled={busy} onClick={() => void create()}><Plus className="size-4" /></Button>
        <Button type="button" variant="ghost" size="icon" className="hidden size-8 xl:inline-flex" aria-label={detailsOpen ? 'Скрыть детали агента' : 'Показать детали агента'} onClick={() => onDetailsChange(!detailsOpen)}>{detailsOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Действия с чатом"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => { setTitle(conversation?.title ?? ''); setRenameOpen(true); }}><Pencil />Переименовать</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void archive()} disabled={busy}><Archive />В архив</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}><Trash2 />Удалить</DropdownMenuItem>
            {conversation && <p className="px-2 py-1.5 text-[10px] text-muted-foreground">Обновлён {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(conversation.updatedAt))}</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <Dialog open={renameOpen} onOpenChange={(open) => { if (!busy) setRenameOpen(open); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Переименовать чат</DialogTitle>
          <DialogDescription>Название сразу обновится в истории разговоров.</DialogDescription>
          <form onSubmit={(event) => { event.preventDefault(); void rename(); }} className="space-y-3">
            <input value={title} onChange={(event) => setTitle(event.target.value)} onFocus={(event) => event.currentTarget.select()} autoFocus maxLength={200} className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" aria-label="Название чата" />
            <DialogFooter className="gap-2 sm:space-x-0"><Button type="button" variant="outline" onClick={() => setRenameOpen(false)} disabled={busy}>Отмена</Button><Button type="submit" disabled={busy || !title.trim()}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={(open) => { if (!busy) setDeleteOpen(open); }}>
        <DialogContent className="sm:max-w-sm" overlayClassName="bg-black/25 backdrop-blur-[1px]">
          <DialogTitle>Удалить чат?</DialogTitle>
          <DialogDescription>История и все ответы этого разговора будут удалены без возможности восстановления.</DialogDescription>
          <DialogFooter className="gap-2 sm:space-x-0"><Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>Отмена</Button><Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>{busy ? 'Удаляю…' : 'Удалить'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConversationMessage({ message, previousUserBody, sending, onRetry, projectId }: { message: AiMessage; previousUserBody?: string; sending: boolean; onRetry: (body: string) => Promise<void>; projectId?: string }): React.ReactElement {
  const [reaction, setReaction] = useState<'up' | 'down' | null>(null);
  const extracted = extractAiAttachments(message.body);
  const actionResult = message.role === 'assistant' ? extractAiActionPlan(extracted.text) : { text: extracted.text, plan: null };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.body);
      toast.success('Сообщение скопировано');
    } catch {
      toast.error('Не удалось скопировать сообщение');
    }
  };
  const user = message.role === 'user';
  return (
    <article className={cn('group flex gap-3', user && 'justify-end')}>
      {!user && <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-foreground text-background"><Bot className="size-4" /></div>}
      <div className={cn('min-w-0 max-w-full overflow-hidden text-sm leading-6', user ? 'max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5' : 'max-w-[calc(100%-2.5rem)] flex-1')}>
        {message.body ? (
          <>
            {actionResult.text && <div className="prose prose-sm max-w-none overflow-x-auto break-words dark:prose-invert prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:bg-muted prose-pre:text-foreground"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{actionResult.text}</ReactMarkdown></div>}
            {extracted.attachments.length > 0 && <MessageAttachments attachments={extracted.attachments} />}
            {actionResult.plan && <AiActionPlanCard plan={actionResult.plan} defaultProjectId={projectId} messageId={message.id} />}
          </>
        ) : (
          <div className="flex items-center gap-2 py-1 text-muted-foreground"><span className="flex gap-1"><i className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-.3s]" /><i className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-.15s]" /><i className="size-1.5 animate-bounce rounded-full bg-current" /></span><span className="text-xs">Формирую ответ</span></div>
        )}
        {message.role === 'assistant' && message.status === 'failed' && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-destructive"><AlertCircle className="size-3.5" /> Ответ не сформирован.{previousUserBody && <button type="button" disabled={sending} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-destructive/10 disabled:opacity-50" onClick={() => void onRetry(previousUserBody).catch(() => undefined)}><RefreshCw className="size-3" />Повторить</button>}</div>
        )}
        {message.role === 'assistant' && message.status === 'completed' && <div className="mt-3 flex items-center gap-1 text-muted-foreground"><button type="button" onClick={() => void copy()} className="grid size-7 place-items-center rounded-md hover:bg-muted hover:text-foreground" aria-label="Копировать ответ"><Copy className="size-3.5" /></button><button type="button" onClick={() => setReaction((value) => value === 'up' ? null : 'up')} className={cn('grid size-7 place-items-center rounded-md hover:bg-muted hover:text-foreground', reaction === 'up' && 'bg-muted text-foreground')} aria-label="Хороший ответ"><ThumbsUp className="size-3.5" /></button><button type="button" onClick={() => setReaction((value) => value === 'down' ? null : 'down')} className={cn('grid size-7 place-items-center rounded-md hover:bg-muted hover:text-foreground', reaction === 'down' && 'bg-muted text-foreground')} aria-label="Плохой ответ"><ThumbsDown className="size-3.5" /></button><span className="ml-1 inline-flex items-center gap-1 text-[10px]"><CheckCircle2 className="size-3" />ИИ завершил</span></div>}
        {user && message.body && <div className="mt-1 flex justify-end opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"><button type="button" onClick={() => void copy()} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground" aria-label="Копировать сообщение"><Copy className="size-3" /></button></div>}
      </div>
      {user && <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><User className="size-4" /></div>}
    </article>
  );
}

function MessageAttachments({ attachments }: { attachments: ReturnType<typeof extractAiAttachments>['attachments'] }): React.ReactElement {
  return <div className="not-prose mt-2 flex flex-wrap gap-2">{attachments.map((attachment) => attachment.kind === 'image' && attachment.previewUrl ? (
    <button key={attachment.id} type="button" className="group relative overflow-hidden rounded-xl border bg-muted" onClick={() => window.open(attachment.previewUrl, '_blank', 'noopener,noreferrer')}><img src={attachment.previewUrl} alt={attachment.name} className="max-h-48 max-w-[280px] object-contain" /><span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-left text-[10px] text-white opacity-0 transition group-hover:opacity-100"><Image className="mr-1 inline size-3" />{attachment.name}</span></button>
  ) : (
    <div key={attachment.id} className="flex max-w-[280px] items-center gap-2 rounded-xl border bg-muted/30 px-2.5 py-2">{attachment.kind === 'text' ? <FileText className="size-4 shrink-0" /> : <Paperclip className="size-4 shrink-0" />}<span className="min-w-0"><span className="block truncate text-xs font-medium">{attachment.name}</span><span className="block text-[10px] text-muted-foreground">{Math.max(1, Math.round(attachment.size / 1024))} КБ</span></span></div>
  ))}</div>;
}

function AgentDetails({ messages }: { messages: readonly AiMessage[] }): React.ReactElement {
  const artifactCount = messages.filter((message) => message.role === 'assistant' && /```|\[[^\]]+\]\([^)]+\)/.test(message.body)).length;
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col overflow-y-auto border-l bg-muted/10 p-3 xl:flex" aria-label="Детали агента">
      <div className="px-2 pb-3 pt-1"><h2 className="text-sm font-semibold">Контекст чата</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Источники, навыки и результаты текущего разговора.</p></div>
      <DetailsSection icon={BookOpen} title="Знания" count={1}><p>Контекст вашего пространства ProjectsFlow и история текущего чата.</p></DetailsSection>
      <DetailsSection icon={Wrench} title="Навыки" count={3}><div className="flex flex-wrap gap-1.5"><span className="rounded-md bg-muted px-2 py-1">Анализ</span><span className="rounded-md bg-muted px-2 py-1">Тексты</span><span className="rounded-md bg-muted px-2 py-1">Код</span></div></DetailsSection>
      <DetailsSection icon={FileOutput} title="Результаты" count={artifactCount}><p>{artifactCount > 0 ? `В ответах найдено результатов: ${artifactCount}. Откройте соответствующий ответ, чтобы скопировать код или ссылку.` : 'Код, ссылки и другие результаты появятся здесь после ответа ИИ.'}</p></DetailsSection>
    </aside>
  );
}

function DetailsSection({ icon: Icon, title, count, children }: { icon: typeof BookOpen; title: string; count: number; children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-t py-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium hover:bg-hover"><ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} /><Icon className="size-4 text-muted-foreground" /><span className="flex-1">{title}</span><span className="text-xs tabular-nums text-muted-foreground">{count}</span></button>
      {open && <div className="px-8 pb-3 pt-1 text-xs leading-5 text-muted-foreground">{children}</div>}
    </section>
  );
}
