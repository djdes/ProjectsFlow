import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { splitTitleBody } from '@/lib/taskTitleBody';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import {
  Check,
  Copy,
  Facebook,
  Flag,
  Linkedin,
  LogIn,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Search,
  Share,
  Twitter,
} from 'lucide-react';
import { coverStyle } from '@/presentation/components/project/coverGallery';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { usePublicBoard } from '@/presentation/hooks/usePublicBoard';
import { appOrigin, boardSlugFromHost, publicBoardUrl } from '@/lib/publicBoardUrl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PublicBoard } from '@/domain/public/PublicBoard';
import { PublicKanban } from './PublicKanban';
import { PublicTaskPanel } from './PublicTaskPanel';

// Общий класс тихой icon-кнопки/ссылки верхней полосы.
const TOP_ICON_CLS =
  'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]';

function TopIconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): React.ReactElement {
  return (
    <button type="button" aria-label={label} title={label} className={TOP_ICON_CLS} {...props}>
      {children}
    </button>
  );
}

// Мини-превью доски в поповере «Поделиться» (обложка + иконка + имя) — как карточка в Notion.
function SharePreview({ board }: { board: PublicBoard | null }): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div
        className="h-12 w-full bg-muted"
        style={board?.coverUrl ? coverStyle(board.coverUrl, board.coverPosition) : undefined}
        aria-hidden
      />
      <div className="flex items-center gap-2 px-3 py-2.5">
        {board?.appearance.showIcon && board.icon && (
          <ProjectIconView icon={board.icon} pixelSize={18} className="shrink-0 text-lg leading-none" />
        )}
        <span className="truncate text-sm font-semibold">{board?.name ?? 'Доска'}</span>
      </div>
    </div>
  );
}

// «Поделиться» (Share site): превью + копировать ссылку + кружки соцсетей.
function SharePopover({ board, url }: { board: PublicBoard | null; url: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent(url);
  const encTitle = encodeURIComponent(board?.name ?? 'ProjectsFlow');
  const socials: { label: string; href: string; icon: React.ReactNode }[] = [
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc}`, icon: <Linkedin className="size-4" /> },
    { label: 'X', href: `https://twitter.com/intent/tweet?url=${enc}&text=${encTitle}`, icon: <Twitter className="size-4" /> },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encTitle}%20${enc}`, icon: <MessageCircle className="size-4" /> },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc}`, icon: <Facebook className="size-4" /> },
    { label: 'Почта', href: `mailto:?subject=${encTitle}&body=${enc}`, icon: <Mail className="size-4" /> },
  ];
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard недоступен — ссылка видна в поле */
    }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <TopIconButton label="Поделиться">
          <Share className="size-4" />
        </TopIconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[92vw] p-4">
        <p className="mb-3 text-center text-sm font-semibold">Поделиться доской</p>
        <SharePreview board={board} />
        <div className="mt-3 flex items-center gap-1.5">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 min-w-0 flex-1 rounded-md border bg-muted/40 px-2.5 text-xs text-muted-foreground outline-none"
          />
          <Button size="sm" className="h-9 shrink-0 gap-1.5" onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Готово' : 'Копировать'}
          </Button>
        </div>
        <div className="mt-3 flex items-center justify-center gap-2.5">
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              title={s.label}
              className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {s.icon}
            </a>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Диалог «Пожаловаться» — как в Notion: причины-радио + Отмена/Пожаловаться.
const REPORT_REASONS = [
  'Фишинг или спам',
  'Неприемлемый контент',
  'DMCA — запрос на удаление',
  'Другое',
] as const;

function ReportDialog({
  open,
  onOpenChange,
  url,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  url: string;
}): React.ReactElement {
  const [reason, setReason] = useState<string | null>(null);
  const submit = (): void => {
    if (!reason) return;
    window.location.href = `mailto:support@projectsflow.ru?subject=${encodeURIComponent(
      `Жалоба на доску: ${reason}`,
    )}&body=${encodeURIComponent(`Причина: ${reason}\nСсылка: ${url}\n\nПодробности:`)}`;
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Почему вы жалуетесь на эту страницу?</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          Страница размещена на ProjectsFlow. Эта форма — для жалоб на нарушение правил. Это не
          форма связи с автором страницы.
        </div>
        <div className="space-y-1">
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent',
                reason === r && 'bg-accent',
              )}
            >
              <span
                className={cn(
                  'grid size-4 shrink-0 place-items-center rounded-full border',
                  reason === r ? 'border-primary' : 'border-muted-foreground/40',
                )}
              >
                {reason === r && <span className="size-2 rounded-full bg-primary" />}
              </span>
              {r}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!reason}
            onClick={submit}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Пожаловаться
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Меню «…»: вход/регистрация + пожаловаться.
function MoreMenu({ onReport }: { onReport: () => void }): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TopIconButton label="Ещё">
          <MoreHorizontal className="size-4" />
        </TopIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem
          className="whitespace-nowrap"
          onSelect={() => (window.location.href = `${appOrigin()}/login`)}
        >
          <LogIn className="size-4 shrink-0" />
          Вход или регистрация
        </DropdownMenuItem>
        <DropdownMenuItem
          className="whitespace-nowrap text-destructive focus:text-destructive"
          onSelect={() => onReport()}
        >
          <Flag className="size-4 shrink-0" />
          Пожаловаться
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Модальный поиск по доске (как в Notion): поле → список задач + превью справа.
function SearchModal({
  open,
  onOpenChange,
  board,
  onOpenTask,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  board: PublicBoard | null;
  onOpenTask: (taskId: string) => void;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const [hoverId, setHoverId] = useState<string | null>(null);
  const allTasks = useMemo(() => board?.columns.flatMap((c) => c.tasks) ?? [], [board]);
  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? allTasks.filter((t) => (t.description ?? '').toLowerCase().includes(query)) : allTasks;
  }, [allTasks, q]);
  const active = results.find((t) => t.id === hoverId) ?? results[0] ?? null;

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const pick = (id: string): void => {
    onOpenTask(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Поиск в «${board?.name ?? 'доске'}»…`}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="flex h-[min(60vh,26rem)]">
          <div className="w-full overflow-y-auto border-r p-2 sm:w-1/2">
            <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              Задачи
            </p>
            {results.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</p>
            ) : (
              results.map((t) => {
                const { title } = splitTitleBody(t.description ?? '');
                return (
                  <button
                    key={t.id}
                    type="button"
                    onMouseEnter={() => setHoverId(t.id)}
                    onClick={() => pick(t.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      active?.id === t.id ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    {t.icon ? (
                      <ProjectIconView icon={t.icon} pixelSize={16} className="shrink-0 text-base leading-none" />
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{title || 'Без названия'}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="hidden w-1/2 p-3 sm:block">
            {active ? (
              <button
                type="button"
                onClick={() => pick(active.id)}
                className="block w-full overflow-hidden rounded-lg border text-left transition-shadow hover:shadow-md"
              >
                <div
                  className="h-16 w-full bg-muted"
                  style={active.cover ? coverStyle(active.cover, active.coverPosition) : undefined}
                  aria-hidden
                />
                <div className="p-3">
                  {active.icon && (
                    <ProjectIconView icon={active.icon} pixelSize={22} className="mb-1 text-xl leading-none" />
                  )}
                  <p className="font-semibold leading-snug">
                    {splitTitleBody(active.description ?? '').title || 'Без названия'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{STATUS_LABEL[active.status]}</p>
                </div>
              </button>
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">Выберите задачу</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Верхняя полоса публичной доски — реплика Notion: слева иконка+имя,
// справа: Поиск (модалка) / Поделиться / Дублировать / «…» / CTA-кнопка.
function PublicTopBar({
  board,
  slug,
  onOpenTask,
}: {
  board: PublicBoard | null;
  slug: string;
  onOpenTask: (taskId: string) => void;
}): React.ReactElement {
  const [searchOpen, setSearchOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const shareUrl = slug ? publicBoardUrl(slug) : window.location.href;
  const registerHref = `${appOrigin()}/register`;

  return (
    <div className="flex h-11 items-center justify-between gap-2 border-b border-black/[0.06] px-3 dark:border-white/[0.06]">
      <div className="flex min-w-0 items-center gap-1.5">
        {board?.icon && (
          <ProjectIconView icon={board.icon} pixelSize={18} className="shrink-0 text-lg leading-none" />
        )}
        <span className="truncate text-sm font-medium text-[#37352f]/80 dark:text-blue-100/80">
          {board?.name ?? ''}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <TopIconButton label="Поиск" onClick={() => setSearchOpen(true)}>
          <Search className="size-4" />
        </TopIconButton>
        <SharePopover board={board} url={shareUrl} />
        <a
          href={`${appOrigin()}/duplicate?slug=${encodeURIComponent(slug)}`}
          aria-label="Дублировать в свой ProjectsFlow"
          title="Дублировать в свой ProjectsFlow"
          className={TOP_ICON_CLS}
        >
          <Copy className="size-4" />
        </a>
        <MoreMenu onReport={() => setReportOpen(true)} />
        <a
          href={registerHref}
          className="ml-1 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: board?.appearance.accentColor ?? '#2383e2' }}
        >
          Попробовать ProjectsFlow
        </a>
      </div>

      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} board={board} onOpenTask={onOpenTask} />
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} url={shareUrl} />
    </div>
  );
}

// Управление <meta name="robots">: индексация публичной доски включается только тогглом
// в окне Publish. Пока indexing=false — просим краулеры не индексировать.
function useRobotsMeta(indexing: boolean | null): void {
  useEffect(() => {
    if (indexing === null) return; // ещё грузится — не трогаем
    const tag = document.createElement('meta');
    tag.name = 'robots';
    tag.content = indexing ? 'index,follow' : 'noindex,nofollow';
    document.head.appendChild(tag);
    return () => {
      document.head.removeChild(tag);
    };
  }, [indexing]);
}

function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

function BoardView({
  board,
  onOpenTask,
}: {
  board: PublicBoard;
  onOpenTask: (taskId: string) => void;
}): React.ReactElement {
  return (
    <>
      {/* Обложка во всю ширину (как в приватном виде и на скрине публичной страницы). */}
      {board.appearance.showCover && board.coverUrl && (
        <div className="h-40 w-full sm:h-52" style={coverStyle(board.coverUrl, board.coverPosition)} aria-hidden />
      )}

      <div className="mx-auto w-full max-w-5xl px-4 sm:px-8">
        {/* Шапка: иконка + имя + описание. */}
        <header className={board.appearance.showCover && board.coverUrl ? '-mt-8' : 'mt-8'}>
          {board.appearance.showIcon && board.icon && (
            <div className="mb-2 grid size-16 place-items-center rounded-xl bg-white text-[44px] leading-none shadow-[0_1px_3px_rgba(15,23,42,0.12)] dark:bg-[#202020]">
              <ProjectIconView icon={board.icon} pixelSize={40} className="text-[40px]" />
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-[#37352f] dark:text-blue-50">
            {board.name}
          </h1>
          {board.appearance.showDescription && board.description && (
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[#37352f]/80 dark:text-blue-100/80">
              {board.description}
            </p>
          )}
        </header>

        {/* Канбан. */}
        <div className="mt-8">
          <PublicKanban
            columns={board.columns}
            onOpenTask={onOpenTask}
            showTaskMeta={board.appearance.showTaskMeta}
          />
        </div>
      </div>
    </>
  );
}

// Публичная страница доски проекта (/p/:slug). Рендерится ВНЕ AppShell/сайдбара и без auth.
export function PublicBoardPage(): React.ReactElement {
  // slug из пути (/p/:slug) ИЛИ из hostname (<slug>.projectsflow.ru, Notion-style поддомен).
  const { slug: paramSlug } = useParams<{ slug: string }>();
  const slug = paramSlug ?? boardSlugFromHost() ?? '';
  const { status, board } = usePublicBoard(slug);
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get('task');

  useRobotsMeta(board ? board.indexing : null);
  useDocumentTitle(board ? board.name : status === 'notfound' ? 'Доска не найдена' : null);

  const openTask = (taskId: string): void => {
    setSearchParams({ task: taskId });
  };
  const closeTask = (): void => {
    setSearchParams({});
  };

  return (
    <div
      className="min-h-dvh bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]"
      style={{ '--pf-public-accent': board?.appearance.accentColor ?? '#2383e2' } as React.CSSProperties}
    >
      {/* Верхняя полоса — реплика публичной страницы Notion. */}
      <PublicTopBar board={board} slug={slug} onOpenTask={openTask} />

      {status === 'loading' && (
        <div className="mx-auto max-w-5xl px-8 py-16">
          <div className="h-40 w-full animate-pulse rounded-xl bg-black/[0.05] dark:bg-white/[0.05]" />
        </div>
      )}

      {status === 'notfound' && (
        <div className="mx-auto max-w-md px-8 py-24 text-center">
          <h1 className="text-xl font-semibold text-foreground">Доска не найдена</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ссылка недействительна или проект больше не опубликован.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="mx-auto max-w-md px-8 py-24 text-center">
          <h1 className="text-xl font-semibold text-foreground">Не удалось загрузить</h1>
          <p className="mt-2 text-sm text-muted-foreground">Попробуйте обновить страницу позже.</p>
        </div>
      )}

      {status === 'ready' && board && <BoardView board={board} onOpenTask={openTask} />}

      {/* Read-only окно задачи (открывается по ?task=<id>, шарится). */}
      {slug && openTaskId && (
        <PublicTaskPanel slug={slug} taskId={openTaskId} onClose={closeTask} />
      )}
    </div>
  );
}
