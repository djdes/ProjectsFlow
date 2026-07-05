import { useEffect, useState } from 'react';
import { Globe, X } from 'lucide-react';
import { useProject } from '@/presentation/hooks/useProject';
import { publicBoardUrl, publicBoardDisplayUrl } from '@/lib/publicBoardUrl';
import { onPublishChanged } from '@/presentation/lib/publishEvents';

type Props = {
  projectId: string;
  // #2: если true — контент плашки центрируется в ВИДИМОЙ области (сдвигается влево на ширину
  // открытого справа окна задачи, ширина берётся из CSS-переменной --pf-drawer-open-w).
  // Ставим только у плашки основного вида; у плашки ВНУТРИ окна — нет.
  shiftForOverlay?: boolean;
};

// Событие синхронизации закрытия между экземплярами плашки (она рендерится и под крошками,
// и в выехавшем справа окне задачи): закрытие в одном месте гасит все копии этого проекта.
// Закрытие живёт только в памяти — при обновлении страницы плашка возвращается (по требованию).
const DISMISS_EVENT = 'pf:published-banner-dismissed';

// Модульный in-memory-набор закрытых проектов — чтобы экземпляр, смонтированный ПОСЛЕ закрытия
// (напр. плашка в окне задачи, которое открыли уже после закрытия плашки на главном), тоже
// стартовал скрытым. Живёт до перезагрузки страницы (плашка возвращается на refresh — по требованию).
const dismissedProjects = new Set<string>();

// Кнопка плашки — белая «пилюля» «Показать сайт» (как в Notion).
const BTN =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-black/[0.08] bg-white px-2.5 py-1 text-[13px] font-medium text-[#37352f] shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-blue-50 dark:hover:bg-white/20';

// Синяя плашка «проект опубликован» — один в один как «This page is live on …» в Notion.
// Показывается ТОЛЬКО когда проект реально опубликован (is_public + public_slug). Адрес —
// projectsflow.ru/p/<slug>; «Показать сайт» открывает публичную доску. Состояние берём из
// useProject + слушаем pf:project-publish-changed (мгновенное обновление после Publish/Unpublish).
export function ProjectPublishedBanner({ projectId, shiftForOverlay = false }: Props): React.ReactElement | null {
  const { data } = useProject(projectId);

  // Публичное состояние: seed из проекта, обновляется событиями публикации.
  const [isPublic, setIsPublic] = useState<boolean>(data?.isPublic ?? false);
  const [slug, setSlug] = useState<string | null>(data?.publicSlug ?? null);

  // Только in-memory: refresh страницы возвращает плашку.
  const [dismissed, setDismissed] = useState(() => dismissedProjects.has(projectId));

  // Синк с загруженным проектом (первый рендер data может быть null).
  useEffect(() => {
    if (data && data.id === projectId) {
      setIsPublic(data.isPublic);
      setSlug(data.publicSlug);
    }
  }, [data, projectId]);

  // Живое обновление после Publish/Unpublish из окна «Поделиться».
  useEffect(() => {
    return onPublishChanged((d) => {
      if (d.projectId !== projectId) return;
      setIsPublic(d.isPublic);
      setSlug(d.publicSlug);
    });
  }, [projectId]);

  useEffect(() => {
    setDismissed(dismissedProjects.has(projectId));
    const onDismiss = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === projectId) setDismissed(true);
    };
    window.addEventListener(DISMISS_EVENT, onDismiss);
    return () => window.removeEventListener(DISMISS_EVENT, onDismiss);
  }, [projectId]);

  if (dismissed) return null;
  if (!isPublic || !slug) return null;

  const address = publicBoardDisplayUrl(slug);

  const close = (): void => {
    // ВАЖНО: пишем в модульный набор — иначе плашка, смонтированная ПОЗЖЕ (окно задачи открыли
    // после закрытия на главном), не узнает о закрытии (событие ловят только уже смонтированные).
    dismissedProjects.add(projectId);
    setDismissed(true);
    window.dispatchEvent(new CustomEvent(DISMISS_EVENT, { detail: projectId }));
  };

  return (
    <div className="relative flex min-h-[4.375rem] shrink-0 items-stretch border-b border-black/[0.05] bg-[#e8f3f9] dark:border-white/[0.06] dark:bg-[#1d2a31]">
      <div
        className="relative flex flex-1 flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-10 py-2 text-[13px] leading-tight text-[#37352f] dark:text-blue-50"
        style={shiftForOverlay ? { marginRight: 'var(--pf-drawer-open-w, 0px)' } : undefined}
      >
        <span className="truncate">
          Проект опубликован на <span className="font-medium">{address}</span>
        </span>
        <a
          href={publicBoardUrl(slug)}
          target="_blank"
          rel="noopener noreferrer"
          className={BTN}
        >
          <Globe className="size-3.5 opacity-80" />
          Показать сайт
        </a>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Скрыть"
        className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-[#37352f]/40 transition-colors hover:bg-black/[0.06] hover:text-[#37352f]/70 dark:text-blue-100/40 dark:hover:bg-white/10 dark:hover:text-blue-50"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
