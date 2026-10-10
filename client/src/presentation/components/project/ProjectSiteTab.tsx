import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { siteResultUrl, siteResultDisplayUrl } from '@/lib/publicBoardUrl';
import type { AppBackendStatus } from '@/application/project/ProjectRepository';

// Байты → «X,X МБ» (одна цифра после запятой). Для индикатора usage бэкенда приложения.
function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`.replace('.', ',');
}

// Вкладка «Сайт проекта» окна «Поделиться»: адрес сайта-РЕЗУЛЬТАТА (<slug>.projectsflow.ru,
// db/100). Есть у каждого проекта всегда — до деплоя воркером по адресу отдаётся заглушка
// «в разработке», после — собранный сайт. Отдельно от вкладки «Публичная доска» (это канбан).
export function ProjectSiteTab({ projectId }: { projectId: string }): React.ReactElement {
  const { projectRepository } = useContainer();
  const [state, setState] = useState<{ slug: string; deployed: boolean } | null>(null);
  const [appBackend, setAppBackend] = useState<AppBackendStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    projectRepository
      .getProjectSite(projectId)
      .then((s) => {
        if (cancelled) return;
        setState(s.siteSlug ? { slug: s.siteSlug, deployed: !!s.deployedAt } : null);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Статус бэкенда приложения — независимо (не блокирует показ адреса сайта).
    projectRepository
      .getAppBackendStatus(projectId)
      .then((s) => {
        if (!cancelled) setAppBackend(s);
      })
      .catch(() => {
        if (!cancelled) setAppBackend(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 motion-safe:animate-spin" /> Загрузка…
      </div>
    );
  }
  if (!state) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">Сайт недоступен для этого проекта.</div>;
  }

  const url = siteResultUrl(state.slug);
  const display = siteResultDisplayUrl(state.slug);
  const copyLink = (): void => {
    void navigator.clipboard.writeText(url);
    toast.success('Ссылка на сайт скопирована');
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">Сайт проекта</h3>
        <span
          className={cn(
            'shrink-0 rounded-sm px-1.5 py-0.5 text-2xs font-medium',
            state.deployed ? 'bg-done-soft text-done-ink' : 'bg-primary-soft text-primary-ink',
          )}
        >
          {state.deployed ? 'Опубликован' : 'В разработке'}
        </span>
      </div>
      <p className="mbs-0.5 text-sm text-muted-foreground">
        Собранный воркером результат вашего проекта.
      </p>

      {/* URL-строка + копирование. */}
      <div className="mbs-3 flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm text-primary-ink">{display}</span>
        <button
          type="button"
          onClick={copyLink}
          aria-label="Скопировать ссылку"
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <Copy className="size-3.5" />
        </button>
      </div>

      <p className="mbs-2 text-xs text-muted-foreground">
        {state.deployed
          ? 'Любой, у кого есть ссылка, увидит результат.'
          : 'Пока воркер ничего не собрал — по ссылке страница-заглушка. Поставьте задачу воркеру в проекте.'}
      </p>

      {/* Бэкенд приложения (db/102): показываем только когда воркер его завёл. */}
      {appBackend?.status === 'active' && (
        // Контейнер нейтральный (C4), смысл «работает» — зелёным в счётчике и полосе.
        <div className="mbs-3 rounded-lg border border-border bg-panel px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">Бэкенд приложения</span>
            <span className="shrink-0 text-2xs font-medium text-done">
              {formatMb(appBackend.usageBytes)} / {formatMb(appBackend.storageLimitBytes)}
            </span>
          </div>
          {/* Полоса заполнения квоты. */}
          <div className="mbs-1.5 h-1.5 w-full overflow-clip rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-done motion-safe:transition-[width]"
              style={{
                width: `${Math.min(100, appBackend.storageLimitBytes > 0 ? (appBackend.usageBytes / appBackend.storageLimitBytes) * 100 : 0)}%`,
              }}
            />
          </div>
          <p className="mbs-1.5 text-xs text-muted-foreground">
            Вход, пользователи и база данных.
            {appBackend.tables.length > 0 && ` Таблицы: ${appBackend.tables.join(', ')}.`}
          </p>
        </div>
      )}

      <Button type="button" className="mbs-3 h-9 w-full gap-1.5" asChild>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-4" />
          Открыть сайт
        </a>
      </Button>
    </div>
  );
}
