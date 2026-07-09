import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { siteResultUrl, siteResultDisplayUrl } from '@/lib/publicBoardUrl';

// Вкладка «Сайт проекта» окна «Поделиться»: адрес сайта-РЕЗУЛЬТАТА (<slug>.projectsflow.ru,
// db/100). Есть у каждого проекта всегда — до деплоя воркером по адресу отдаётся заглушка
// «в разработке», после — собранный сайт. Отдельно от вкладки «Публичная доска» (это канбан).
export function ProjectSiteTab({ projectId }: { projectId: string }): React.ReactElement {
  const { projectRepository } = useContainer();
  const [state, setState] = useState<{ slug: string; deployed: boolean } | null>(null);
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
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Загрузка…
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
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
            state.deployed
              ? 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
              : 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
          )}
        >
          {state.deployed ? 'Опубликован' : 'В разработке'}
        </span>
      </div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Собранный воркером результат вашего проекта.
      </p>

      {/* URL-строка + копирование. */}
      <div className="mt-3 flex items-center gap-1.5 rounded-md border border-black/[0.08] bg-black/[0.02] px-2.5 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
        <span className="min-w-0 flex-1 truncate text-[13px] text-blue-600 dark:text-blue-400">{display}</span>
        <button
          type="button"
          onClick={copyLink}
          aria-label="Скопировать ссылку"
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/10"
        >
          <Copy className="size-3.5" />
        </button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {state.deployed
          ? 'Любой, у кого есть ссылка, увидит результат.'
          : 'Пока воркер ничего не собрал — по ссылке страница-заглушка. Поставьте задачу воркеру в проекте.'}
      </p>

      <Button type="button" className="mt-3 h-9 w-full gap-1.5" asChild>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-4" />
          Открыть сайт
        </a>
      </Button>
    </div>
  );
}
