import { useEffect, useId, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ExternalLink,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { siteResultUrl } from '@/lib/publicBoardUrl';
import { cn } from '@/lib/utils';
import type { ProjectSite } from '@/application/project/ProjectRepository';

type Device = 'desktop' | 'tablet' | 'mobile';
const DEVICE: Record<Device, { label: string; width: string; icon: typeof Monitor }> = {
  desktop: { label: 'Компьютер', width: '100%', icon: Monitor },
  tablet: { label: 'Планшет', width: '768px', icon: Tablet },
  mobile: { label: 'Телефон', width: '390px', icon: Smartphone },
};

function normalizePath(raw: string): string | null {
  let value = raw.trim();
  if (!value) return '/';
  if (!value.startsWith('/')) value = `/${value}`;
  const hasControlCharacter = [...value].some((character) => character.charCodeAt(0) < 32);
  if (value.startsWith('//') || value.includes('\\') || hasControlCharacter) return null;
  try {
    const parsed = new URL(value, 'https://preview.projectsflow.invalid');
    if (parsed.origin !== 'https://preview.projectsflow.invalid') return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function ProjectPreview({ projectId }: { projectId: string }): React.ReactElement {
  const { projectRepository } = useContainer();
  const datalistId = useId();
  const [site, setSite] = useState<ProjectSite | null>(null);
  const [loadingSite, setLoadingSite] = useState(true);
  const [siteError, setSiteError] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const [draftPath, setDraftPath] = useState('/');
  const [path, setPath] = useState('/');
  const [frameKey, setFrameKey] = useState(0);
  const [frameLoading, setFrameLoading] = useState(true);
  const [slowFrame, setSlowFrame] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      projectRepository.getProjectSite(projectId)
        .then((result) => {
          if (cancelled) return;
          setSite(result);
          setSiteError(false);
        })
        .catch(() => { if (!cancelled) setSiteError(true); })
        .finally(() => { if (!cancelled) setLoadingSite(false); });
    };
    load();
    const timer = window.setInterval(load, site?.deployedAt ? 60_000 : 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, projectRepository, site?.deployedAt]);

  useEffect(() => {
    if (!frameLoading) return;
    setSlowFrame(false);
    const timer = window.setTimeout(() => setSlowFrame(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [frameKey, frameLoading, path]);

  const baseUrl = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const previewUrl = baseUrl ? `${baseUrl}${path === '/' ? '/' : path}` : null;
  const routes = [...new Set([...(site?.routes?.length ? site.routes : ['/']), path])];

  const applyPath = (): void => {
    const normalized = normalizePath(draftPath);
    if (!normalized) {
      toast.error('Укажите путь внутри сайта, например /catalog');
      return;
    }
    setDraftPath(normalized);
    setPath(normalized);
    setFrameLoading(true);
    setFrameKey((key) => key + 1);
  };

  if (loadingSite) {
    return <div className="grid min-h-[420px] place-items-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Загружаем Preview…</div>;
  }

  if (siteError) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-xl border border-dashed">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto mb-3 size-6 text-destructive" />
          <p className="font-medium">Не удалось получить результат проекта</p>
          <p className="mt-1 text-sm text-muted-foreground">Проверьте соединение и попробуйте обновить Preview.</p>
          <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>Повторить</Button>
        </div>
      </div>
    );
  }

  if (!site?.siteSlug || !site.deployedAt || !previewUrl) {
    return (
      <div className="grid min-h-[440px] place-items-center rounded-xl border border-dashed bg-muted/10 px-6">
        <div className="max-w-md text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-500/10 text-blue-600"><Monitor className="size-6" /></span>
          <h2 className="mt-4 text-lg font-semibold">Preview появится после первого запуска</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Как только воркер опубликует результат, сайт откроется здесь автоматически — без перезагрузки страницы.
          </p>
        </div>
      </div>
    );
  }

  const CurrentDeviceIcon = DEVICE[device].icon;
  return (
    <section className="overflow-hidden rounded-xl border bg-muted/20" aria-label="Preview результата проекта">
      <div className="flex min-h-12 flex-wrap items-center gap-1.5 border-b bg-background px-2 py-1.5">
        <form
          className="flex min-w-[220px] flex-1 items-center rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/30"
          onSubmit={(event) => { event.preventDefault(); applyPath(); }}
        >
          <input
            value={draftPath}
            onChange={(event) => setDraftPath(event.target.value)}
            list={datalistId}
            aria-label="Путь страницы результата"
            className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
            placeholder="/catalog"
          />
          <datalist id={datalistId}>{routes.map((route) => <option key={route} value={route} />)}</datalist>
          <button type="submit" className="grid size-9 place-items-center text-muted-foreground hover:text-foreground" aria-label="Открыть путь">
            <ChevronDown className="size-4" />
          </button>
        </form>

        <div className="flex items-center rounded-lg border bg-background p-0.5" aria-label="Размер Preview">
          {(Object.keys(DEVICE) as Device[]).map((item) => {
            const Icon = DEVICE[item].icon;
            return (
              <button
                key={item}
                type="button"
                title={DEVICE[item].label}
                aria-label={DEVICE[item].label}
                aria-pressed={device === item}
                onClick={() => setDevice(item)}
                className={cn('grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground', device === item && 'bg-muted text-foreground')}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          title="Обновить Preview"
          onClick={() => { setFrameLoading(true); setFrameKey((key) => key + 1); }}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button asChild type="button" variant="outline" size="sm" className="h-9 gap-1.5">
          <a href={previewUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5" />Открыть</a>
        </Button>
      </div>

      <div className="relative min-h-[620px] overflow-auto bg-[#f3f3f2] p-3 dark:bg-[#111] sm:p-5">
        <div
          className="relative mx-auto min-h-[580px] overflow-hidden border bg-white transition-[width] duration-300 ease-out dark:bg-zinc-950"
          style={{ width: DEVICE[device].width, maxWidth: '100%' }}
        >
          {frameLoading && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-background">
              <div className="text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
                {slowFrame ? 'Сайт загружается дольше обычного…' : 'Загружаем результат…'}
              </div>
            </div>
          )}
          <iframe
            key={frameKey}
            src={previewUrl}
            title={`Результат проекта — ${path}`}
            className="h-[700px] w-full border-0 bg-white"
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setFrameLoading(false)}
          />
        </div>
        <span className="pointer-events-none absolute bottom-5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
          <CurrentDeviceIcon className="size-3" />{DEVICE[device].label}
        </span>
      </div>
    </section>
  );
}
