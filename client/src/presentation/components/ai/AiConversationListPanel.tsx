import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ChevronRight, FolderKanban, MoreHorizontal, Pencil, Plus, Search, Sparkles } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { AiConversation } from '@/domain/ai-chat/AiConversation';
import {
  conversationActivityAt,
  useAiConversations,
  announceAiConversationsChanged,
} from '@/presentation/hooks/useAiConversations';
import { formatRelativeTime, groupByRecency } from './relativeTime';
import { useContainer } from '@/infrastructure/di/container';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const NEW_CHAT_HINT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  ? '⌘O'
  : 'Ctrl+O';

/**
 * Возвращает «свежий» `Date.now()` раз в минуту: относительное время считается при рендере,
 * а без тика строка «сейчас» залипла бы до следующего обновления списка.
 */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function AiConversationListPanel(): React.ReactElement {
  const { aiConversationRepository } = useContainer();
  const { items, loading, error } = useAiConversations();
  const navigate = useNavigate();
  const now = useMinuteTick();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const filtered = useMemo(() => items.filter((item) => item.title.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))), [items, search]);
  const personalItems = useMemo(() => filtered.filter((item) => item.kind === 'personal'), [filtered]);
  const projectItems = useMemo(() => filtered.filter((item) => item.kind === 'project_studio'), [filtered]);
  // Группируем только личные чаты: проектные живут в отдельной свёрнутой секции ниже.
  const groups = useMemo(() => groupByRecency(personalItems, conversationActivityAt, now), [personalItems, now]);
  const showProjects = projectsOpen || search.trim().length > 0;

  const create = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const conversation = await aiConversationRepository.create({ kind: 'personal', title: 'Новый чат' });
      announceAiConversationsChanged();
      navigate(`/ai/c/${conversation.id}`);
    } finally {
      setBusy(false);
    }
  }, [aiConversationRepository, busy, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'o' || isTypingTarget(event.target)) return;
      event.preventDefault();
      void create();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [create]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-1 pb-2">
        <div className="grid size-7 place-items-center rounded-lg bg-foreground text-background"><Sparkles className="size-4" /></div>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">Мои ИИ-чаты</div>
        <button type="button" onClick={() => void create()} disabled={busy} className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground" aria-label="Новый чат">
          <Plus className="size-4" />
        </button>
      </div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск чатов" className="h-8 w-full rounded-lg border bg-background pl-8 pr-2 text-xs outline-none focus:border-primary/50" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {loading && <div className="space-y-1 py-1">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-8 animate-pulse rounded-lg bg-muted" />)}</div>}
        {!loading && error && <p className="px-2 py-4 text-xs text-destructive">Не удалось загрузить чаты.</p>}
        {!loading && !error && groups.length === 0 && <p className="px-2 py-5 text-xs leading-5 text-muted-foreground">{search.trim() ? 'Личные чаты не найдены.' : 'Создайте личный чат — он будет всегда под рукой.'}</p>}
        {groups.map((group) => (
          <section key={group.label} className="mb-3">
            <h3 className="sticky top-0 z-10 bg-sidebar/90 px-2 py-1 text-xs font-medium leading-5 text-muted-foreground backdrop-blur-sm">{group.label}</h3>
            <div className="space-y-0.5">
              {group.items.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} now={now} />)}
            </div>
          </section>
        ))}
        {!loading && !error && projectItems.length > 0 && (
          <section className="mt-3 border-t pt-2">
            <button
              type="button"
              aria-expanded={showProjects}
              onClick={() => setProjectsOpen((value) => !value)}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-medium text-muted-foreground transition hover:bg-hover hover:text-foreground"
            >
              <ChevronRight className={cn('size-3.5 transition-transform', showProjects && 'rotate-90')} />
              <FolderKanban className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-left">Чаты проектов</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{projectItems.length}</span>
            </button>
            {showProjects && (
              <div className="mt-1 space-y-0.5 pl-2">
                {projectItems.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} now={now} project />)}
              </div>
            )}
          </section>
        )}
      </div>
      {/* min-h + padding, а не фикс-высота: под safe-area кнопка должна расти вниз, а не сжиматься. */}
      <div className="shrink-0 border-t bg-sidebar/95 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition hover:bg-hover disabled:opacity-50"
        >
          <Plus className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Новый чат</span>
          <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-normal text-muted-foreground">{NEW_CHAT_HINT}</kbd>
        </button>
      </div>
    </div>
  );
}

function ConversationRow({ conversation, now, project = false }: { conversation: AiConversation; now: number; project?: boolean }): React.ReactElement {
  const { aiConversationRepository } = useContainer();
  const [renameOpen, setRenameOpen] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const conversationPath = `/ai/c/${conversation.id}`;
  const isCurrent = location.pathname === conversationPath;

  const rename = async (): Promise<void> => {
    const nextTitle = title.trim();
    if (!nextTitle || busy) return;
    if (nextTitle === conversation.title) {
      setRenameOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await aiConversationRepository.update(conversation.id, { title: nextTitle, expectedVersion: conversation.version });
      announceAiConversationsChanged();
      setRenameOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось переименовать чат');
    } finally {
      setBusy(false);
    }
  };

  const archive = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await aiConversationRepository.update(conversation.id, { archived: true, expectedVersion: conversation.version });
      announceAiConversationsChanged();
      if (isCurrent) navigate('/ai');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="group relative min-w-0">
        <NavLink
          to={conversationPath}
          title={conversation.title}
          className={({ isActive }) => cn('flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 pr-8 text-xs transition hover:bg-hover', isActive && 'bg-active font-medium')}
        >
          {project ? <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" /> : <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground transition group-hover:opacity-0">
            {formatRelativeTime(conversationActivityAt(conversation), now)}
          </span>
        </NavLink>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="absolute right-1 top-1 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-background group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:bg-background data-[state=open]:opacity-100" aria-label={`Действия с чатом «${conversation.title}»`}>
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="w-44">
            <DropdownMenuItem onSelect={() => { setTitle(conversation.title); setError(null); setRenameOpen(true); }}><Pencil />Переименовать</DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onSelect={() => void archive()}><Archive />В архив</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={renameOpen} onOpenChange={(open) => { if (!busy) setRenameOpen(open); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Переименовать чат</DialogTitle>
          <DialogDescription>Название будет обновлено в истории разговоров.</DialogDescription>
          <form onSubmit={(event) => { event.preventDefault(); void rename(); }} className="space-y-3">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              autoFocus
              maxLength={200}
              aria-label="Название чата"
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none ring-offset-background transition focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:space-x-0">
              <button type="button" onClick={() => setRenameOpen(false)} disabled={busy} className="h-9 rounded-lg border px-3 text-sm transition hover:bg-hover disabled:opacity-50">Отмена</button>
              <button type="submit" disabled={!title.trim() || busy} className="h-9 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition disabled:opacity-40">{busy ? 'Сохраняю…' : 'Сохранить'}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
