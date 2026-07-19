import { useMemo, useState } from 'react';
import { Archive, ChevronRight, FolderKanban, MoreHorizontal, Pencil, Plus, Search, Sparkles } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { AiConversation } from '@/domain/ai-chat/AiConversation';
import { useAiConversations, announceAiConversationsChanged } from '@/presentation/hooks/useAiConversations';
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

type Group = { label: string; items: AiConversation[] };

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function groupConversations(items: AiConversation[]): Group[] {
  const now = startOfDay(new Date());
  const buckets = new Map<string, AiConversation[]>();
  for (const item of items) {
    const time = Date.parse(item.lastMessageAt ?? item.updatedAt);
    const days = Math.max(0, Math.floor((now - startOfDay(new Date(time))) / 86_400_000));
    const label = days === 0 ? 'Сегодня' : days <= 7 ? 'Прошлая неделя' : days <= 30 ? 'Последние 30 дней' : 'Ранее';
    const bucket = buckets.get(label) ?? [];
    bucket.push(item);
    buckets.set(label, bucket);
  }
  return ['Сегодня', 'Прошлая неделя', 'Последние 30 дней', 'Ранее']
    .map((label) => ({ label, items: buckets.get(label) ?? [] }))
    .filter((group) => group.items.length > 0);
}

function conversationAge(conversation: AiConversation): string {
  const value = new Date(conversation.lastMessageAt ?? conversation.updatedAt);
  const delta = Date.now() - value.getTime();
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return 'сейчас';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} д`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(value);
}

export function AiConversationListPanel(): React.ReactElement {
  const { aiConversationRepository } = useContainer();
  const { items, loading, error } = useAiConversations();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const filtered = useMemo(() => items.filter((item) => item.title.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))), [items, search]);
  const personalItems = useMemo(() => filtered.filter((item) => item.kind === 'personal'), [filtered]);
  const projectItems = useMemo(() => filtered.filter((item) => item.kind === 'project_studio'), [filtered]);
  const groups = useMemo(() => groupConversations(personalItems), [personalItems]);
  const showProjects = projectsOpen || search.trim().length > 0;

  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const conversation = await aiConversationRepository.create({ kind: 'personal', title: 'Новый чат' });
      announceAiConversationsChanged();
      navigate(`/ai/c/${conversation.id}`);
    } finally {
      setBusy(false);
    }
  };

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
      <button type="button" onClick={() => void create()} disabled={busy} className="mb-2 flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium transition hover:bg-hover">
        <Plus className="size-4" /> Новый чат
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {loading && <div className="space-y-1 py-1">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-8 animate-pulse rounded-lg bg-muted" />)}</div>}
        {!loading && error && <p className="px-2 py-4 text-xs text-destructive">Не удалось загрузить чаты.</p>}
        {!loading && !error && groups.length === 0 && <p className="px-2 py-5 text-xs leading-5 text-muted-foreground">{search.trim() ? 'Личные чаты не найдены.' : 'Создайте личный чат — он будет всегда под рукой.'}</p>}
        {groups.map((group) => (
          <section key={group.label} className="mb-3">
            <h3 className="px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">{group.label}</h3>
            <div className="space-y-0.5">
              {group.items.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} />)}
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
                {projectItems.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} project />)}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ConversationRow({ conversation, project = false }: { conversation: AiConversation; project?: boolean }): React.ReactElement {
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
          <span className="min-w-0 truncate">{conversation.title}</span>
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground transition group-hover:opacity-0">{conversationAge(conversation)}</span>
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
