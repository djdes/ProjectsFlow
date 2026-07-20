import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Archive, ArrowDown, CheckCircle2, ChevronDown, Copy, FileText, Image, Loader2, MoreHorizontal, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Plus, RefreshCw, Share2, Sparkles, ThumbsDown, ThumbsUp, Trash2, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useAiConversation } from '@/presentation/hooks/useAiConversation';
import { useAiConversations, announceAiConversationsChanged } from '@/presentation/hooks/useAiConversations';
import { useAiChatPanels } from '@/presentation/hooks/useAiChatPanels';
import { useContainer } from '@/infrastructure/di/container';
import type { AiConversation, AiMessage } from '@/domain/ai-chat/AiConversation';
import { readAiAgentSteps } from '@/domain/ai-chat/AiAgentStep';
import { readAiSelectionRef, type AiSelectionRef } from '@/domain/ai-chat/AiSelectionRef';
import { readAiSuggestions } from '@/domain/ai-chat/AiSuggestion';
import type { AiActionBatchStatus } from '@/domain/ai-action/AiActionBatch';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AiComposer, type AiComposerInsert, type AiComposerMode } from './AiComposer';
import { AiComposerPresets } from './AiComposerPresets';
import { extractAiAttachments } from './aiAttachments';
import { AiActionPlanCard, extractAiActionPlan } from './AiActionPlanCard';
import { AiAgentStepsBlock } from './AiAgentStepsBlock';
import { AiKnowledgePanel } from './AiKnowledgePanel';
import { AiArtifactsPanel } from './AiArtifactsPanel';
import { AiSelectionChip } from './AiSelectionChip';
import { AiSuggestionChips } from './AiSuggestionChips';
import { formatRelativeTime } from './relativeTime';

/**
 * Одна ли это зона. Сравниваем маршрут и селектор: собственного id у зоны нет, а
 * artifactVersion/jobId меняются от правки к правке и для сравнения не годятся.
 */
function isSameZone(a: AiSelectionRef, b: AiSelectionRef): boolean {
  return a.route === b.route && a.selector === b.selector;
}

export function AiConversationView({
  conversationId,
  compact = false,
  projectName,
  projectId,
  hideHeader = false,
  onOpenSelection,
  selection,
  onBuild,
}: {
  conversationId: string;
  compact?: boolean;
  projectName?: string;
  projectId?: string;
  hideHeader?: boolean;
  // Клик по чипу зоны в сообщении. Приходит только оттуда, где есть предпросмотр
  // (Project Studio); без него чип рисуется как read-only отметка.
  onOpenSelection?: (selection: AiSelectionRef) => void;
  // Зона, выделенная в предпросмотре прямо сейчас, — поднята из правой панели.
  selection?: AiSelectionRef | null;
  // Отправка в режиме «Правка»: промпт уходит в job визуального редактора (тот же путь,
  // что и у правой панели), а пару сообщений в ленте создаёт сервер. Нет колбэка —
  // нет и режима: тумблер не показывается. Отклонённый промис = правку не приняли.
  onBuild?: (prompt: string) => void | Promise<void>;
}): React.ReactElement {
  const state = useAiConversation(conversationId);
  const scrollArea = useRef<HTMLDivElement | null>(null);
  const wasNearBottom = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280);
  // Заполнение композера снаружи (пресет на пустом чате, чип-подсказка). Привязано к
  // диалогу: при переключении чата текст соседнего в поле не переезжает.
  const [insert, setInsert] = useState<(AiComposerInsert & { conversationId: string }) | null>(null);
  // Умолчание — «делать». «Размышление» включают сознательно, когда хотят подумать,
  // а не получить сразу правку. Тумблер доступен всегда: думать можно и вне режима
  // правки, и без выделенной зоны.
  const [composerMode, setComposerMode] = useState<AiComposerMode>('build');
  const personalWorkspace = !projectName && !hideHeader && !compact;
  const composerInsert = insert?.conversationId === conversationId ? insert : null;

  // Поле не управляется React — текст в него кладём через нонс-токен, а не перемонтируя
  // композер: после клика по чипу-подсказке фокус обязан остаться на чипе (референс R2.2).
  const fillComposer = (text: string, focus: boolean): void => {
    setInsert((current) => ({
      conversationId,
      text,
      focus,
      token: (current?.conversationId === conversationId ? current.token : 0) + 1,
    }));
  };

  const send = async (body: string, mode: AiComposerMode): Promise<void> => {
    // «Размышление»: планировщик без прав на действия. Режим 'chat' — тот, которому
    // сервер НЕ выдаёт actionProtocol, поэтому агент физически не создаст ни задачу,
    // ни проект, даже если его об этом попросить.
    if (mode === 'discuss') {
      await state.send(body, 'chat');
      return;
    }
    // Дальше режим «делать». С выделенной зоной — адресная правка сайта тем же путём,
    // что и из правой панели; без зоны — обычный планировщик, который вправе предложить
    // действия над проектом.
    if (onBuild && selection) {
      // Отказ канала правки обязан вернуться сюда. Композер очищает поле ДО отправки и
      // возвращает текст только по исключению (AiComposer.submit), так что проглоченный
      // здесь отказ означал бы бесследно исчезнувший промпт.
      try {
        await onBuild(body);
      } catch (error) {
        toast.error(error instanceof Error && error.message ? error.message : 'Не удалось отправить правку.');
        throw error;
      }
      return;
    }
    await state.send(body, projectName ? 'studio_plan' : 'chat');
  };

  /**
   * Повтор неудавшегося ответа. У правки элемента путь принципиально другой: сайт меняет
   * только канал «Правка», а обычное сообщение в чат создало бы текстовый ответ ПРО
   * изменение — пользователь считал бы, что повторил, хотя на сайте ничего не произошло.
   */
  const retry = async (body: string, zone: AiSelectionRef | null): Promise<void> => {
    if (!zone || !onBuild) {
      await state.send(body, projectName ? 'studio_plan' : 'chat');
      return;
    }
    // Та же зона всё ещё выделена — повторяем правку сразу, одним кликом.
    if (selection && isSameZone(selection, zone)) {
      await send(body, 'build');
      return;
    }
    // Зоны под рукой нет, а job редактора без неё не существует. Открываем её в
    // предпросмотре и кладём промпт в композер: отправку оставляем пользователю, потому
    // что выделение приедет только через навигацию и рукопожатие моста.
    if (!onOpenSelection) {
      toast.error('Откройте зону в предпросмотре, чтобы повторить правку.');
      return;
    }
    onOpenSelection(zone);
    // Повтор правки — это действие, а не размышление: если «Размышление» было включено,
    // выключаем его, иначе отправка ушла бы в планировщик и сайт остался бы прежним.
    setComposerMode('build');
    fillComposer(body, false);
    toast.info('Зона открыта в предпросмотре — отправьте промпт, чтобы повторить правку.');
  };

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
    // Во время стрима лента должна быть прижата к низу НЕПРЕРЫВНО: ответ растёт кусками
    // по 5–16 символов каждые 30–1500 мс, и плавная прокрутка на каждый кусок не успевает
    // доехать — низ ленты всё время «догоняет» текст. Плавность оставляем только для
    // готовых сообщений, где скачок был бы заметен.
    const streaming = state.messages.some((message) => message.role === 'assistant' && (message.status === 'queued' || message.status === 'running'));
    const frame = window.requestAnimationFrame(() => scrollToLatest(streaming || state.messages.length <= 1 ? 'auto' : 'smooth'));
    return () => window.cancelAnimationFrame(frame);
    // Keep the surrounding application shell in place: only this conversation
    // viewport is allowed to scroll when a new message arrives.
  }, [state.messages]);

  if (state.loading && state.messages.length === 0) {
    return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }

  // Подсказки — свойство последнего ответа: новый ход заменяет предыдущий набор,
  // как в референсе. Сообщения без поля `suggestions` просто не дают блока.
  const lastAssistant = [...state.messages].reverse().find((message) => message.role === 'assistant');
  const suggestions = readAiSuggestions(lastAssistant?.metadata);

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
              {/* Шаг колонки — 10px, как в референсе. Больше не нужно: ряд действий под
                  каждым сообщением смонтирован всегда и сам работает разделителем, а
                  прежние 24px превращали ленту в редкую лесенку. */}
              <div className={cn('mx-auto flex min-h-full min-w-0 w-full flex-col gap-2.5 px-4 py-6', compact ? 'max-w-3xl' : 'max-w-4xl')}>
                {state.messages.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
                    <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-foreground text-background shadow-lg"><Sparkles className="size-7" /></div>
                    <h2 className="text-xl font-semibold">{projectName ? `Работаем над «${projectName}»` : 'Чем помочь?'}</h2>
                    <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                      {projectName ? 'Обсуждайте код, интерфейс и данные проекта. Любое изменение сайта будет предложением и потребует явного подтверждения.' : 'Задайте вопрос, продумайте идею или разберите задачу. История сохранится здесь автоматически.'}
                    </p>
                    {!compact && <AiComposerPresets className="mt-6 w-full max-w-2xl" disabled={state.sending} onPick={(prompt) => fillComposer(prompt, true)} />}
                  </div>
                ) : state.messages.map((message, index) => {
                  const previousUser = [...state.messages.slice(0, index)].reverse().find((item) => item.role === 'user');
                  return (
                    <ConversationMessage
                      key={message.id}
                      message={message}
                      previousUser={previousUser}
                      sending={state.sending}
                      onRetry={retry}
                      projectId={projectId}
                      onOpenSelection={onOpenSelection}
                    />
                  );
                })}
                {state.error && <div className="mx-auto flex max-w-lg items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertCircle className="size-4 shrink-0" />{state.error}</div>}
                <div aria-hidden="true" />
              </div>
            </div>
            {/* Кнопка «вниз» висит НАД лентой и не входит в её поток: она прижата к низу
                области прокрутки, поэтому композер не перекрывает и высоты не добавляет.
                Держим её смонтированной и гасим прозрачностью — так появление плавное,
                а не рывком. */}
            <button
              type="button"
              onClick={() => scrollToLatest()}
              aria-label="Перейти к последнему сообщению"
              aria-hidden={!showJumpToLatest}
              tabIndex={showJumpToLatest ? 0 : -1}
              className={cn(
                'absolute bottom-4 left-1/2 z-20 grid size-9 -translate-x-1/2 place-items-center rounded-full border bg-background/95 text-muted-foreground shadow-lg backdrop-blur',
                'transition-opacity duration-300 hover:text-foreground',
                showJumpToLatest ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              <ArrowDown className="size-4" />
            </button>
          </div>
          <div className="shrink-0 border-t bg-background/95 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <div className={cn('mx-auto', compact ? 'max-w-3xl' : 'max-w-4xl')}>
              {/* Подсказки живут НАД композером и приезжают из metadata последнего ответа.
                  Своего генератора у нас нет: сервер не прислал — блок не рендерится. */}
              <AiSuggestionChips suggestions={suggestions} onPick={(prompt) => fillComposer(prompt, false)} />
              <AiComposer
                key={conversationId}
                conversationId={conversationId}
                sending={state.sending}
                onSend={send}
                compact={compact}
                insert={composerInsert}
                selection={selection}
                onOpenSelection={onOpenSelection}
                modeSwitch={onBuild ? { mode: composerMode, onChange: setComposerMode } : undefined}
              />
              {!compact && <p className="pt-1.5 text-center text-[10px] text-muted-foreground">ИИ может ошибаться. Проверяйте важные ответы.</p>}
            </div>
          </div>
        </div>
        {/* Панели — только персональный режим и только от xl: в студии проекта и на
            мобиле правой колонки нет, её появление сломало бы обе раскладки. */}
        {personalWorkspace && detailsOpen && (
          <AgentDetails conversationId={conversationId} revision={state.messages.length} />
        )}
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

function ConversationMessage({ message, previousUser, sending, onRetry, projectId, onOpenSelection }: { message: AiMessage; previousUser?: AiMessage; sending: boolean; onRetry: (body: string, zone: AiSelectionRef | null) => Promise<void>; projectId?: string; onOpenSelection?: (selection: AiSelectionRef) => void }): React.ReactElement {
  const [reaction, setReaction] = useState<'up' | 'down' | null>(null);
  // Статус батча поднят сюда только ради шага «Требуется подтверждение»: он обязан
  // стоять последним в блоке шагов, то есть НАД телом ответа, а сама карточка
  // подтверждения живёт под ним.
  const [batchStatus, setBatchStatus] = useState<AiActionBatchStatus | null>(null);
  const extracted = extractAiAttachments(message.body);
  const actionResult = message.role === 'assistant' ? extractAiActionPlan(extracted.text) : { text: extracted.text, plan: null };
  const steps = message.role === 'assistant' ? readAiAgentSteps(message.metadata) : [];
  // Зона правки приезжает только в пользовательском сообщении — это отметка того,
  // к чему был привязан промпт, а не часть ответа.
  const selection = message.role === 'user' ? readAiSelectionRef(message.metadata) : null;
  // На повтор уходит промпт предыдущего пользовательского сообщения, а его зона (её
  // проставляет только серверный путь редактора) отличает правку элемента от вопроса.
  const retryBody = previousUser?.body;
  const retryZone = previousUser ? readAiSelectionRef(previousUser.metadata) : null;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.body);
      toast.success('Сообщение скопировано');
    } catch {
      toast.error('Не удалось скопировать сообщение');
    }
  };
  const user = message.role === 'user';
  // У пустого ассистентского пузыря копировать ещё нечего, и его место занято
  // индикатором «Формирую ответ» — там ряда действий нет.
  const showActions = Boolean(message.body);
  return (
    // Две формы сообщения (референс §2): у ассистента НЕТ ни пузыря, ни аватара — ответ
    // идёт простым текстом во всю ширину колонки; пузырь и аватар есть только у
    // пользователя, причём аватар стоит НАД пузырём, а не сбоку.
    <article
      data-message-role={message.role}
      className={cn('group/chat-bubble flex w-full min-w-0 flex-col gap-1.5', user ? 'items-end pl-4' : 'items-start')}
    >
      {user && (
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden>
          <User className="size-3.5" />
        </span>
      )}
      <div className={cn(
        'min-w-0 max-w-full overflow-hidden text-sm leading-6',
        user ? 'select-text rounded-md bg-message-bubble p-3' : 'w-full',
      )}>
        {!user && <AiAgentStepsBlock steps={steps} needsReview={batchStatus === 'pending_review'} />}
        {/* Как в референсе: бейдж зоны — первый ребёнок внутри пузыря, над текстом
            промпта. Контейнер с переносом — зон в одном сообщении может стать больше. */}
        {selection && <div className="mb-1.5 flex flex-wrap items-center gap-1"><AiSelectionChip selection={selection} onOpen={onOpenSelection} /></div>}
        {message.body ? (
          <>
            {actionResult.text && <div className="prose prose-sm max-w-none overflow-x-auto break-words dark:prose-invert prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:bg-muted prose-pre:text-foreground"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{actionResult.text}</ReactMarkdown></div>}
            {extracted.attachments.length > 0 && <MessageAttachments attachments={extracted.attachments} />}
            {actionResult.plan && <AiActionPlanCard plan={actionResult.plan} defaultProjectId={projectId} messageId={message.id} conversationId={message.conversationId} onBatchStatusChange={setBatchStatus} />}
          </>
        ) : (
          <div className="flex items-center gap-2 py-1 text-muted-foreground"><span className="flex gap-1"><i className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-.3s]" /><i className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-.15s]" /><i className="size-1.5 animate-bounce rounded-full bg-current" /></span><span className="text-xs">Формирую ответ</span></div>
        )}
        {message.role === 'assistant' && message.status === 'failed' && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-destructive"><AlertCircle className="size-3.5" /> {retryZone ? 'Правка не выполнена.' : 'Ответ не сформирован.'}{retryBody && <button type="button" disabled={sending} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-destructive/10 disabled:opacity-50" onClick={() => void onRetry(retryBody, retryZone).catch(() => undefined)}><RefreshCw className="size-3" />{retryZone ? 'Повторить правку' : 'Повторить'}</button>}</div>
        )}
      </div>
      {showActions && (
        <MessageActions
          message={message}
          user={user}
          reaction={reaction}
          onReaction={setReaction}
          onCopy={() => void copy()}
        />
      )}
    </article>
  );
}

/**
 * Ряд действий под сообщением. Ключевое из референса (§2): ряд смонтирован ВСЕГДА и
 * занимает своё место, а по наведению лишь проявляется прозрачностью за 150 мс — иначе
 * лента дёргалась бы на каждое движение курсора. Относительное время с точным
 * в `title` — оттуда же.
 */
function MessageActions({
  message,
  user,
  reaction,
  onReaction,
  onCopy,
}: {
  message: AiMessage;
  user: boolean;
  reaction: 'up' | 'down' | null;
  onReaction: (value: 'up' | 'down' | null) => void;
  onCopy: () => void;
}): React.ReactElement {
  const createdAt = Date.parse(message.createdAt);
  const exact = Number.isFinite(createdAt)
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(createdAt)
    : '';
  return (
    <div className={cn(
      'flex w-full items-center gap-2 text-xs text-muted-foreground',
      'opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/chat-bubble:opacity-100',
      user ? 'justify-end' : 'justify-start',
    )}>
      {Number.isFinite(createdAt) && (
        <time dateTime={message.createdAt} title={exact} className="truncate leading-4">{formatRelativeTime(createdAt)}</time>
      )}
      <span className="flex items-center gap-0.5">
        <button type="button" onClick={onCopy} className="grid size-6 place-items-center rounded hover:bg-hover hover:text-foreground" aria-label={user ? 'Копировать сообщение' : 'Копировать ответ'}><Copy className="size-3.5" /></button>
        {!user && (
          <>
            <button type="button" onClick={() => onReaction(reaction === 'up' ? null : 'up')} className={cn('grid size-6 place-items-center rounded hover:bg-hover hover:text-foreground', reaction === 'up' && 'bg-hover text-foreground')} aria-label="Хороший ответ"><ThumbsUp className="size-3.5" /></button>
            <button type="button" onClick={() => onReaction(reaction === 'down' ? null : 'down')} className={cn('grid size-6 place-items-center rounded hover:bg-hover hover:text-foreground', reaction === 'down' && 'bg-hover text-foreground')} aria-label="Плохой ответ"><ThumbsDown className="size-3.5" /></button>
          </>
        )}
      </span>
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments: ReturnType<typeof extractAiAttachments>['attachments'] }): React.ReactElement {
  return <div className="not-prose mt-2 flex flex-wrap gap-2">{attachments.map((attachment) => attachment.kind === 'image' && attachment.previewUrl ? (
    <button key={attachment.id} type="button" className="group relative overflow-hidden rounded-xl border bg-muted" onClick={() => window.open(attachment.previewUrl, '_blank', 'noopener,noreferrer')}><img src={attachment.previewUrl} alt={attachment.name} className="max-h-48 max-w-[280px] object-contain" /><span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-left text-[10px] text-white opacity-0 transition group-hover:opacity-100"><Image className="mr-1 inline size-3" />{attachment.name}</span></button>
  ) : (
    <div key={attachment.id} className="flex max-w-[280px] items-center gap-2 rounded-xl border bg-muted/30 px-2.5 py-2">{attachment.kind === 'text' ? <FileText className="size-4 shrink-0" /> : <Paperclip className="size-4 shrink-0" />}<span className="min-w-0"><span className="block truncate text-xs font-medium">{attachment.name}</span><span className="block text-[10px] text-muted-foreground">{Math.max(1, Math.round(attachment.size / 1024))} КБ</span></span></div>
  ))}</div>;
}

// Правая колонка референса: ровно две сворачиваемые панели шириной 318px —
// «что смотрели» и «что сделали». Разделение принципиальное, в одну ленту не сводится.
function AgentDetails({ conversationId, revision }: { conversationId: string; revision: number }): React.ReactElement {
  const { knowledge, artifacts, loading } = useAiChatPanels(conversationId, revision);
  return (
    <aside className="hidden w-[318px] shrink-0 flex-col gap-1 overflow-y-auto border-l bg-muted/10 p-3 xl:flex" aria-label="Детали агента">
      <AiKnowledgePanel sources={knowledge} loading={loading} />
      <div className="border-t" />
      <AiArtifactsPanel artifacts={artifacts} loading={loading} />
    </aside>
  );
}
