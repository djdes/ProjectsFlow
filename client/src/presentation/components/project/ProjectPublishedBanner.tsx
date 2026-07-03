import { useEffect, useState } from 'react';
import { Globe, X } from 'lucide-react';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';

type Props = {
  projectId: string;
};

// Событие синхронизации закрытия между экземплярами плашки (она рендерится и под крошками,
// и в выехавшем справа окне): закрытие в одном месте гасит все копии этого проекта.
const DISMISS_EVENT = 'pf:published-banner-dismissed';

// Синяя плашка «проект опубликован» в стиле Notion («This page is live on …»). Закрывается
// (per-project, sessionStorage). Адрес — <логин>.projectsflow.ru, где логин = local-part email
// текущего юзера. Кнопка «Показать сайт» и ссылка пока заглушки (функционал добавится позже).
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
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-blue-200/70 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
      <span className="inline-flex items-center gap-1.5">
        <Globe className="size-3.5 shrink-0 opacity-70" />
        Проект опубликован на <span className="font-medium">{address}</span>
      </span>
      {/* Заглушка: пока не ведёт на сайт. */}
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-blue-300/70 bg-white/70 px-2 py-0.5 font-medium text-blue-700 transition-colors hover:bg-white dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/70"
      >
        Показать сайт
      </button>
      <button
        type="button"
        onClick={close}
        aria-label="Закрыть"
        className="grid size-5 place-items-center rounded text-blue-600/70 transition-colors hover:bg-blue-100 hover:text-blue-800 dark:hover:bg-blue-900/60 dark:hover:text-blue-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
