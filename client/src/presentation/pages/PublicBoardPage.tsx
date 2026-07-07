import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Check, Flag, LogIn, MoreHorizontal, Share2 } from 'lucide-react';
import { coverStyle } from '@/presentation/components/project/coverGallery';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { usePublicBoard } from '@/presentation/hooks/usePublicBoard';
import { appOrigin, boardSlugFromHost, publicBoardUrl } from '@/lib/publicBoardUrl';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PublicBoard } from '@/domain/public/PublicBoard';
import { PublicKanban } from './PublicKanban';
import { PublicTaskPanel } from './PublicTaskPanel';

// Тихая icon-кнопка верхней полосы публичной доски.
function TopIconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
      {...props}
    >
      {children}
    </button>
  );
}

// «Поделиться»: копирование ссылки + шеринг в соцсети (как «Share site» в Notion).
function SharePopover({ url, title }: { url: string; title: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent(url);
  const encTitle = encodeURIComponent(title);
  const socials: { label: string; href: string }[] = [
    { label: 'Telegram', href: `https://t.me/share/url?url=${enc}&text=${encTitle}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encTitle}%20${enc}` },
    { label: 'VK', href: `https://vk.com/share.php?url=${enc}&title=${encTitle}` },
    { label: 'X', href: `https://twitter.com/intent/tweet?url=${enc}&text=${encTitle}` },
  ];
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard недоступен — ссылка и так видна в поле */
    }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <TopIconButton label="Поделиться">
          <Share2 className="size-4" />
        </TopIconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="mb-2 text-sm font-semibold">Поделиться доской</p>
        <div className="flex items-center gap-1.5">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-8 min-w-0 flex-1 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground outline-none"
          />
          <Button size="sm" className="h-8 shrink-0 gap-1" onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : null}
            {copied ? 'Готово' : 'Копировать'}
          </Button>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {s.label}
            </a>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Меню «…»: вход/регистрация + пожаловаться (как в Notion Report page).
function MoreMenu({ reportUrl }: { reportUrl: string }): React.ReactElement {
  const loginHref = `${appOrigin()}/login`;
  const reportHref = `mailto:support@projectsflow.ru?subject=${encodeURIComponent(
    'Жалоба на публичную доску',
  )}&body=${encodeURIComponent(`Ссылка на доску: ${reportUrl}\n\nОпишите проблему:`)}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TopIconButton label="Ещё">
          <MoreHorizontal className="size-4" />
        </TopIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => (window.location.href = loginHref)}>
          <LogIn className="size-4" />
          Войти или зарегистрироваться
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => (window.location.href = reportHref)}
        >
          <Flag className="size-4" />
          Пожаловаться
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Верхняя полоса публичной доски: слева иконка+имя, справа «Поделиться», «…» и CTA-кнопка.
function PublicTopBar({ board, slug }: { board: PublicBoard | null; slug: string }): React.ReactElement {
  const shareUrl = slug ? publicBoardUrl(slug) : window.location.href;
  return (
    <div className="flex h-11 items-center justify-between gap-2 border-b border-black/[0.06] px-3 dark:border-white/[0.06]">
      <div className="flex min-w-0 items-center gap-1.5">
        {board?.icon && <ProjectIconView icon={board.icon} pixelSize={18} className="text-lg leading-none" />}
        <span className="truncate text-sm font-medium text-[#37352f]/80 dark:text-blue-100/80">
          {board?.name ?? ''}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <SharePopover url={shareUrl} title={board?.name ?? 'ProjectsFlow'} />
        <MoreMenu reportUrl={shareUrl} />
        <a
          href={`${appOrigin()}/register`}
          className="ml-1 rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Создать в&nbsp;ProjectsFlow
        </a>
      </div>
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
      {board.coverUrl && (
        <div className="h-40 w-full sm:h-52" style={coverStyle(board.coverUrl, board.coverPosition)} aria-hidden />
      )}

      <div className="mx-auto w-full max-w-5xl px-4 sm:px-8">
        {/* Шапка: иконка + имя + описание. */}
        <header className={board.coverUrl ? '-mt-8' : 'mt-8'}>
          {board.icon && (
            <div className="mb-2 grid size-16 place-items-center rounded-xl bg-white text-[44px] leading-none shadow-[0_1px_3px_rgba(15,23,42,0.12)] dark:bg-[#202020]">
              <ProjectIconView icon={board.icon} pixelSize={40} className="text-[40px]" />
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-[#37352f] dark:text-blue-50">
            {board.name}
          </h1>
          {board.description && (
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[#37352f]/80 dark:text-blue-100/80">
              {board.description}
            </p>
          )}
        </header>

        {/* Канбан. */}
        <div className="mt-8">
          <PublicKanban columns={board.columns} onOpenTask={onOpenTask} />
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
    <div className="min-h-dvh bg-background pb-16">
      {/* Верхняя полоса: имя доски + «Поделиться»/«…»/CTA (как публичная страница Notion). */}
      <PublicTopBar board={board} slug={slug} />

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
