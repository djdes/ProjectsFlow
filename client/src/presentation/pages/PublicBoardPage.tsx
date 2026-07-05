import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { coverStyle } from '@/presentation/components/project/coverGallery';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { usePublicBoard } from '@/presentation/hooks/usePublicBoard';
import type { PublicBoard } from '@/domain/public/PublicBoard';
import { PublicKanban } from './PublicKanban';
import { PublicTaskPanel } from './PublicTaskPanel';

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
  const { slug } = useParams<{ slug: string }>();
  const { status, board } = usePublicBoard(slug ?? '');
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
      {/* Тонкая верхняя полоса с брендом (как chrome-окна на скрине Publish). */}
      <div className="flex h-11 items-center justify-between border-b border-black/[0.06] px-4 dark:border-white/[0.06]">
        <span className="text-sm font-medium text-[#37352f]/60 dark:text-blue-100/60">
          {board?.name ?? ''}
        </span>
        <a
          href="/"
          className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          ProjectsFlow
        </a>
      </div>

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
