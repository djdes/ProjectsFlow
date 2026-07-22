import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { useContainer } from '@/infrastructure/di/container';
import { siteResultUrl, siteResultDisplayUrl } from '@/lib/publicBoardUrl';
import { useRightPanelWidth } from '@/presentation/layout/rightPanelContext';
import { ProjectBannerDismissButton } from './ProjectBannerDismissButton';
import { useProjectBannersHidden } from './projectBannersSetting';
import {
  announceProjectSitePublished,
  PROJECT_SITE_PUBLISHED_EVENT,
  type ProjectSitePublishedDetail,
} from './projectSitePublishedEvent';

type Props = {
  projectId: string;
  // #2: если true — контент плашки центрируется в ВИДИМОЙ области (сдвигается влево на ширину
  // открытого справа окна задачи, ширина берётся из CSS-переменной --pf-drawer-open-w).
  // Ставим только у плашки основного вида; у плашки ВНУТРИ окна — нет.
  shiftForOverlay?: boolean;
};

// Собственной памяти о закрытии у плашки больше нет: раньше крестик писал projectId в модульный
// in-memory-набор и рассылал событие между экземплярами. Теперь крестик включает ОБЩУЮ настройку
// «плашки скрыты» (pf:project-banners-hidden), а она и так глобальна и переживает перезагрузку,
// поэтому локальный флаг стал лишним слоем — он бы только мешал: пользователь вернул бы плашки
// тумблером в «⋯», а эта осталась бы скрытой по своей старой памяти. Мигрировать нечего —
// флаг жил лишь до перезагрузки страницы.

// Кнопка плашки — белая «пилюля» «Открыть результат» (как в Notion).
const BTN =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-black/[0.08] bg-white px-2.5 py-1 text-[13px] font-medium text-[#37352f] shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-blue-50 dark:hover:bg-white/20';

// Синяя плашка «результат опубликован» — один в один как «This page is live on …» в Notion, но
// про РЕЗУЛЬТАТ проекта (задеплоенный воркером статический сайт на <slug>.projectsflow.ru), НЕ про
// публичную доску (доска включается тумблером в окне «Поделиться»). Появляется, только когда воркер
// уже что-то задеплоил (site-артефакт, self-serve воркер-раннер, M3). Пока результата нет — тихо
// поллим (воркер до-деплоивает асинхронно), чтобы плашка всплыла сама, без ручного refresh.
export function ProjectPublishedBanner({ projectId, shiftForOverlay = false }: Props): React.ReactElement | null {
  const { projectRepository } = useContainer();
  const rightPanelWidth = useRightPanelWidth();
  // siteSlug есть у каждого проекта ещё до первого результата, поэтому одного slug недостаточно:
  // плашку показываем только после реального деплоя воркера (deployedAt).
  const [site, setSite] = useState<{ slug: string } | null>(null);

  // Гейт стоит и здесь, а не только у места рендера: эту же плашку рисует выехавшее справа
  // окно задачи, и после закрытия крестиком не должна остаться видимой ни одна копия.
  const bannersHidden = useProjectBannersHidden();

  // Пока результата нет — лёгкий поллинг. После первого деплоя плашка появляется сама,
  // без перезагрузки страницы и без промежуточного состояния «в разработке».
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    setSite(null);
    const load = (): void => {
      projectRepository
        .getProjectSite(projectId)
        .then((s) => {
          if (cancelled) return;
          if (!s.siteSlug || !s.deployedAt) {
            setSite(null);
            return;
          }
          setSite({ slug: s.siteSlug });
          announceProjectSitePublished({ projectId, slug: s.siteSlug });
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        })
        .catch(() => {
          /* нет доступа — просто ждём следующий тик */
        });
    };
    load();
    timer = setInterval(load, 25000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [projectRepository, projectId]);

  // Вторая стадия GitHub-onboarding поллит тот же результат. Событие позволяет обеим
  // плашкам переключиться одним кадром: призыв к запуску исчезает, синяя плашка появляется.
  useEffect(() => {
    const onPublished = (event: Event): void => {
      const detail = (event as CustomEvent<ProjectSitePublishedDetail>).detail;
      if (detail?.projectId === projectId) setSite({ slug: detail.slug });
    };
    window.addEventListener(PROJECT_SITE_PUBLISHED_EVENT, onPublished);
    return () => window.removeEventListener(PROJECT_SITE_PUBLISHED_EVENT, onPublished);
  }, [projectId]);

  if (bannersHidden) return null;
  if (!site) return null;

  const address = siteResultDisplayUrl(site.slug);
  const url = siteResultUrl(site.slug);

  return (
    <div
      className="relative flex min-h-[4.375rem] shrink-0 items-stretch border-b border-black/[0.05] bg-[#e8f3f9] transition-[margin] duration-300 ease-in-out dark:border-white/[0.06] dark:bg-[#1d2a31]"
      style={shiftForOverlay ? { marginRight: rightPanelWidth } : undefined}
    >
      <div
        className="relative flex flex-1 flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-10 py-2 text-[13px] leading-tight text-[#37352f] dark:text-blue-50"
        style={shiftForOverlay ? { marginRight: 'var(--pf-drawer-open-w, 0px)' } : undefined}
      >
        <span className="truncate">
          Результат проекта опубликован на{' '}
          <span className="font-medium">{address}</span>
        </span>
        <a href={url} target="_blank" rel="noopener noreferrer" className={BTN}>
          <Globe className="size-3.5 opacity-80" />
          Открыть результат
        </a>
      </div>
      <ProjectBannerDismissButton className="top-1/2 -translate-y-1/2 text-[#37352f]/40 hover:bg-black/[0.06] hover:text-[#37352f]/70 dark:text-blue-100/40 dark:hover:bg-white/10 dark:hover:text-blue-50" />
    </div>
  );
}
