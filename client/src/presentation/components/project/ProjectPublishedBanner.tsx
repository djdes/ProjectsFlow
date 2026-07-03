import { useEffect, useState } from 'react';
import { Globe, Settings2, X } from 'lucide-react';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';

type Props = {
  projectId: string;
};

// Событие синхронизации закрытия между экземплярами плашки (она рендерится и под крошками,
// и в выехавшем справа окне задачи): закрытие в одном месте гасит все копии этого проекта.
const DISMISS_EVENT = 'pf:published-banner-dismissed';

// Кнопки плашки — белые «пилюли» как в Notion (View site / Site settings). Пока заглушки.
const BTN =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/90 px-2 py-1 text-[12px] font-medium text-[#37352f] shadow-sm ring-1 ring-black/[0.06] transition-colors hover:bg-white dark:bg-white/10 dark:text-blue-50 dark:ring-white/10 dark:hover:bg-white/20';

// Синяя плашка «проект опубликован» — один в один как «This page is live on …» в Notion:
// бледно-голубой фон, по центру текст с адресом + белые кнопки «Показать сайт» / «Настройки
// сайта». Один и тот же компонент рендерится под крошками и в окне задачи, поэтому в окне
// плашка выглядит бесшовным продолжением. Закрывается (per-project, sessionStorage).
// Адрес — <логин>.projectsflow.ru, где логин = local-part email текущего юзера.
export function ProjectPublishedBanner({ projectId }: Props): React.ReactElement | null {
  const { user } = useCurrentUser();
  const dismissKey = `pf-published-banner-dismissed:${projectId}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(dismissKey) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onDismiss = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === projectId) setDismissed(true);
    };
    window.addEventListener(DISMISS_EVENT, onDismiss);
    return () => window.removeEventListener(DISMISS_EVENT, onDismiss);
  }, [projectId]);

  if (dismissed) return null;

  const login = (user?.email ?? '').split('@')[0] || 'you';
  const address = `${login}.projectsflow.ru`;

  const close = (): void => {
    setDismissed(true);
    try {
      sessionStorage.setItem(dismissKey, '1');
    } catch {
      /* sessionStorage недоступен — плашка закроется только на этот рендер */
    }
    window.dispatchEvent(new CustomEvent(DISMISS_EVENT, { detail: projectId }));
  };

  return (
    <div className="relative flex shrink-0 flex-wrap items-center justify-center gap-x-2.5 gap-y-1 border-b border-black/[0.05] bg-[#e7f3f8] px-10 py-2 text-[13px] leading-tight text-[#37352f] dark:border-white/[0.06] dark:bg-[#1d2a31] dark:text-blue-50">
      <span className="truncate">
        Проект опубликован на <span className="font-medium">{address}</span>
      </span>
      {/* Заглушки: пока не ведут никуда. */}
      <button type="button" className={BTN}>
        <Globe className="size-3.5 opacity-80" />
        Показать сайт
      </button>
      <button type="button" className={BTN}>
        <Settings2 className="size-3.5 opacity-80" />
        Настройки сайта
      </button>
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
