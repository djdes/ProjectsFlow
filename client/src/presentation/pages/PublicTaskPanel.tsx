import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Copy, Flag, Loader2, Maximize2 } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { splitTitleBody } from '@/lib/taskTitleBody';
import { coverStyle } from '@/presentation/components/project/coverGallery';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { Markdown } from '@/presentation/components/markdown/Markdown';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import { boardSlugFromHost, publicBoardUrl } from '@/lib/publicBoardUrl';
import type { PublicComment, PublicTaskDetail } from '@/domain/public/PublicBoard';

const PRIORITY_COLOR: Record<1 | 2 | 3 | 4, string> = {
  1: '#ef4444', 2: '#f59e0b', 3: '#3b82f6', 4: '#94a3b8',
};
const PRIORITY_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: 'Срочно', 2: 'Высокий', 3: 'Средний', 4: 'Низкий',
};

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

function CommentRow({ c }: { c: PublicComment }): React.ReactElement {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground">
        {c.authorAvatarUrl ? (
          <img src={c.authorAvatarUrl} alt="" className="size-full object-cover" />
        ) : (
          (c.authorDisplayName.trim()[0] ?? '?').toUpperCase()
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-foreground">{c.authorDisplayName}</span>
          <span className="text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>
        </div>
        <Markdown className="mt-0.5 text-[13px]">{c.body}</Markdown>
      </div>
    </li>
  );
}

// Read-only окно задачи на публичной доске (Sheet справа, как в приложении). Показывает тело
// с абзацами/фото, статус/приоритет/дедлайн и комментарии — всё только для чтения, без
// редакторов/полей ввода/меню. «Развернуть» ведёт на гейт-страницу /p/:slug/t/:taskId.
export function PublicTaskPanel({
  slug,
  taskId,
  onClose,
}: {
  slug: string;
  taskId: string;
  onClose: () => void;
}): React.ReactElement {
  const { publicBoardRepository } = useContainer();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<PublicTaskDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setDetail(null);
    publicBoardRepository
      .getTaskDetail(slug, taskId)
      .then((d) => {
        if (cancelled) return;
        if (d) {
          setDetail(d);
          setStatus('ready');
        } else {
          setStatus('notfound');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('notfound');
      });
    return () => {
      cancelled = true;
    };
  }, [publicBoardRepository, slug, taskId]);

  const title = detail ? splitTitleBody(detail.description ?? '').title : '';
  const body = detail ? splitTitleBody(detail.description ?? '').body : '';

  // Открыть отдельной страницей: на поддомене доски роут /t/:taskId, на апексе — /p/:slug/t/:taskId.
  const expandPath = boardSlugFromHost() ? `/t/${taskId}` : `/p/${slug}/t/${taskId}`;

  const copyLink = (): void => {
    void navigator.clipboard.writeText(`${publicBoardUrl(slug)}?task=${taskId}`);
    toast.success('Ссылка скопирована');
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        {/* Верхняя панель действий (read-only: только развернуть + копировать). */}
        <div className="sticky top-0 z-10 flex items-center justify-end gap-1 border-b bg-background/80 px-2 py-1.5 backdrop-blur">
          <button
            type="button"
            onClick={() => navigate(expandPath)}
            aria-label="Открыть отдельной страницей"
            className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Maximize2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={copyLink}
            aria-label="Копировать ссылку"
            className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Copy className="size-4" />
          </button>
        </div>

        {status === 'loading' && (
          <div className="grid flex-1 place-items-center py-24 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}

        {status === 'notfound' && (
          <div className="px-6 py-24 text-center text-sm text-muted-foreground">
            Задача недоступна.
          </div>
        )}

        {status === 'ready' && detail && (
          <div className="flex-1">
            {detail.cover && (
              <div className="h-32 w-full" style={coverStyle(detail.cover, detail.coverPosition)} aria-hidden />
            )}
            <div className="px-6 py-5">
              <div className="flex items-start gap-2.5">
                {detail.icon && (
                  <span className="grid size-8 shrink-0 place-items-center text-2xl leading-none">
                    <ProjectIconView icon={detail.icon} pixelSize={28} />
                  </span>
                )}
                <SheetTitle className="text-xl font-bold leading-snug text-foreground">
                  {title || 'Без названия'}
                </SheetTitle>
              </div>

              {/* Чипы: статус / приоритет / дедлайн (read-only). */}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-muted-foreground">
                  {STATUS_LABEL[detail.status]}
                </span>
                {detail.priority && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-muted-foreground">
                    <Flag className="size-3" style={{ color: PRIORITY_COLOR[detail.priority] }} />
                    {PRIORITY_LABEL[detail.priority]}
                  </span>
                )}
                {detail.deadline && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-muted-foreground">
                    <Calendar className="size-3" />
                    {fmtDate(detail.deadline)}
                  </span>
                )}
              </div>

              {/* Тело задачи (абзацы + фото), read-only. */}
              {body.trim() && <Markdown className="mt-4">{body}</Markdown>}

              {/* Комментарии (только чтение). */}
              {detail.comments.length > 0 && (
                <div className="mt-6 border-t pt-4">
                  <h3 className="mb-3 text-sm font-medium text-foreground">
                    Комментарии{' '}
                    <span className="text-muted-foreground">{detail.comments.length}</span>
                  </h3>
                  <ul className="space-y-4">
                    {detail.comments.map((c) => (
                      <CommentRow key={c.id} c={c} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
