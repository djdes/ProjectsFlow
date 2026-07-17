import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Github,
  Link2,
  Loader2,
  Play,
  Rocket,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { CreateRepoDialog } from '@/presentation/components/github/CreateRepoDialog';
import { ImportProjectRepoDialog } from '@/presentation/components/github/ImportProjectRepoDialog';
import { RepoPickerDialog } from '@/presentation/components/github/RepoPickerDialog';
import { ConnectGithubDialog } from '@/presentation/components/github/ConnectGithubDialog';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useTasks } from '@/presentation/hooks/useTasks';
import { useContainer } from '@/infrastructure/di/container';
import type { Task } from '@/domain/task/Task';
import {
  announceProjectSitePublished,
  PROJECT_SITE_PUBLISHED_EVENT,
  type ProjectSitePublishedDetail,
} from './projectSitePublishedEvent';

type Action = 'create' | 'import' | 'link';
type SiteState = 'checking' | 'pending' | 'published';

type Props = {
  projectId: string;
  projectName: string;
  gitRepoUrl: string | null;
  shiftForOverlay?: boolean;
};

type LaunchBannerProps = Pick<Props, 'projectId' | 'shiftForOverlay'>;

const copy: Record<Action, { title: string; description: string; confirm: string }> = {
  create: {
    title: 'Создать репозиторий на GitHub?',
    description: 'Создадим приватный репозиторий, включим делегацию доступа воркеру и подготовим базу знаний.',
    confirm: 'Настроить репозиторий',
  },
  import: {
    title: 'Импортировать готовый проект?',
    description: 'Загрузим ZIP в новый или пустой репозиторий, включим делегацию воркеру и подготовим базу знаний.',
    confirm: 'Выбрать ZIP',
  },
  link: {
    title: 'Подключить существующий репозиторий?',
    description: 'Подключим репозиторий, разрешим воркеру работать с ним и подготовим локальную базу знаний.',
    confirm: 'Выбрать репозиторий',
  },
};

function isLaunchProjectTask(task: Task): boolean {
  const title = (task.description ?? '').split(/\r?\n/, 1)[0].replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
  return title === 'запустить проект';
}

function ProjectLaunchBanner({ projectId, shiftForOverlay = false }: LaunchBannerProps): React.ReactElement {
  const { user } = useCurrentUser();
  const { projectRepository } = useContainer();
  const { tasks, loading, create } = useTasks(projectId);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);

  const launchTasks = useMemo(() => tasks.filter(isLaunchProjectTask), [tasks]);
  const activeLaunchTask = launchTasks.find((task) => task.status !== 'done');
  const isRetry = !activeLaunchTask && launchTasks.some((task) => task.status === 'done');

  const createLaunchTask = async (): Promise<void> => {
    if (!user || launchBusy || activeLaunchTask) return;
    setLaunchBusy(true);
    try {
      // Идемпотентный догон для проектов, где GitHub подключили до появления
      // единого onboarding: перед первой задачей гарантируем делегацию и KB.
      await projectRepository.ensureAppRepo(projectId);
      await create({
        description: 'Запустить проект',
        status: 'todo',
        assigneeUserId: user.id,
      });
      toast.success('Задача «Запустить проект» добавлена воркеру');
      setLaunchOpen(false);
    } catch {
      toast.error('Не удалось подготовить проект и отправить задачу');
    } finally {
      setLaunchBusy(false);
    }
  };

  const actionLabel = loading
    ? 'Проверяем задачи…'
    : activeLaunchTask
      ? activeLaunchTask.status === 'in_progress'
        ? 'Воркер запускает проект'
        : activeLaunchTask.status === 'awaiting_clarification'
          ? 'В задаче нужен ответ'
          : 'Задача уже отправлена'
      : isRetry
        ? 'Запустить повторно'
        : 'Запустить проект';

  return (
    <>
      <div className="border-b border-violet-950/10 bg-[linear-gradient(105deg,#eef2ff_0%,#f5f3ff_48%,#ecfeff_100%)] px-4 py-3 dark:border-white/10 dark:bg-[linear-gradient(105deg,#172036_0%,#261b3a_50%,#123039_100%)] sm:px-8">
        <div
          className="mx-auto flex max-w-[1180px] animate-in flex-col gap-3 fade-in slide-in-from-top-2 duration-500 transition-[margin] xl:flex-row xl:items-center xl:justify-between motion-reduce:animate-none"
          style={shiftForOverlay ? { marginRight: 'var(--pf-drawer-open-w, 0px)' } : undefined}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-600/20 ring-4 ring-white/70 dark:ring-white/10">
              <Rocket className="size-5" />
              <span className="absolute -right-1 -top-1 size-2.5 animate-pulse rounded-full bg-cyan-400 ring-2 ring-white dark:ring-slate-900" />
            </span>
            <div className="min-w-0">
              <div className="mb-0.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-3" />
                  Код подключён
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-violet-600/70 dark:text-violet-300/70">
                  Шаг 2 из 2
                </span>
              </div>
              <div className="text-sm font-semibold text-foreground">Теперь запустите проект</div>
              <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Репозиторий, делегация доступа и база знаний готовы. Воркер проверит код и опубликует результат.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={loading || Boolean(activeLaunchTask)}
            onClick={() => setLaunchOpen(true)}
            className="group inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 text-xs font-semibold text-white shadow-md shadow-violet-600/20 transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-default disabled:opacity-75 disabled:hover:translate-y-0"
          >
            {loading || activeLaunchTask?.status === 'in_progress' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : activeLaunchTask ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
            {actionLabel}
            {!loading && !activeLaunchTask && (
              <ArrowRight className="size-3.5 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            )}
          </button>
        </div>
      </div>

      <Dialog open={launchOpen} onOpenChange={(open) => !launchBusy && setLaunchOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-600">
                <Rocket className="size-4" />
              </span>
              {isRetry ? 'Запустить проект повторно?' : 'Отправить проект на запуск?'}
            </DialogTitle>
            <DialogDescription>
              Создадим задачу «Запустить проект» в канбане воркера. Он проверит репозиторий, запустит проект и опубликует результат.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={launchBusy} onClick={() => setLaunchOpen(false)}>Не сейчас</Button>
            <Button disabled={launchBusy || !user || Boolean(activeLaunchTask)} onClick={() => void createLaunchTask()}>
              {launchBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
              Отправить воркеру
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProjectGithubOnboardingBanner({
  projectId,
  projectName,
  gitRepoUrl,
  shiftForOverlay = false,
}: Props): React.ReactElement | null {
  const { connection } = useGithubConnection();
  const { projectRepository } = useContainer();
  const [intro, setIntro] = useState<Action | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [siteState, setSiteState] = useState<SiteState>(gitRepoUrl ? 'checking' : 'pending');

  const openAction = (action: Action): void => {
    if (action === 'create') setCreateOpen(true);
    else if (action === 'import') setImportOpen(true);
    else setPickerOpen(true);
  };

  useEffect(() => {
    if (connection && pending) {
      openAction(pending);
      setPending(null);
    }
  }, [connection, pending]);

  useEffect(() => {
    if (!gitRepoUrl) {
      setSiteState('pending');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    setSiteState('checking');

    const load = (): void => {
      projectRepository
        .getProjectSite(projectId)
        .then((site) => {
          if (cancelled) return;
          if (!site.siteSlug || !site.deployedAt) {
            setSiteState('pending');
            return;
          }
          setSiteState('published');
          announceProjectSitePublished({ projectId, slug: site.siteSlug });
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        })
        .catch(() => {
          // При временной сетевой ошибке не показываем ложный призыв уже
          // опубликованному проекту — следующий тик повторит точную проверку.
        });
    };

    load();
    timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [gitRepoUrl, projectId, projectRepository]);

  useEffect(() => {
    const onPublished = (event: Event): void => {
      const detail = (event as CustomEvent<ProjectSitePublishedDetail>).detail;
      if (detail?.projectId === projectId) setSiteState('published');
    };
    window.addEventListener(PROJECT_SITE_PUBLISHED_EVENT, onPublished);
    return () => window.removeEventListener(PROJECT_SITE_PUBLISHED_EVENT, onPublished);
  }, [projectId]);

  const proceed = (): void => {
    if (!intro) return;
    const action = intro;
    setIntro(null);
    if (!connection) {
      setPending(action);
      setConnectOpen(true);
      return;
    }
    openAction(action);
  };

  if (gitRepoUrl) {
    if (siteState !== 'pending') return null;
    return <ProjectLaunchBanner projectId={projectId} shiftForOverlay={shiftForOverlay} />;
  }

  return (
    <>
      <div className="border-b border-indigo-950/10 bg-[linear-gradient(105deg,#f5f7ff_0%,#f7f3ff_45%,#f0f9ff_100%)] px-4 py-3 dark:border-white/10 dark:bg-[linear-gradient(105deg,#171a2c_0%,#21192d_48%,#13232d_100%)] sm:px-8">
        <div
          className="mx-auto flex max-w-[1180px] flex-col gap-3 transition-[margin] duration-300 xl:flex-row xl:items-center xl:justify-between"
          style={shiftForOverlay ? { marginRight: 'var(--pf-drawer-open-w, 0px)' } : undefined}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white shadow-sm ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
                <Sparkles className="size-3.5 text-violet-600 dark:text-violet-300" />
              </span>
              Подключите код проекта
            </div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Выберите способ подключения — делегация доступа воркеру и локальная база знаний настроятся автоматически.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-medium text-muted-foreground">
              {['Репозиторий', 'Делегация', 'База знаний'].map((label) => (
                <span key={label} className="inline-flex items-center gap-1">
                  <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="grid shrink-0 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setIntro('create')}
              className="group inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#24292f] px-3.5 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#1b1f23] hover:shadow-md"
            >
              <Github className="size-4" />
              Создать на GitHub
              <ArrowRight className="size-3.5 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </button>
            <button
              type="button"
              onClick={() => setIntro('import')}
              className="group inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-3.5 text-xs font-semibold text-white shadow-sm shadow-violet-600/20 transition hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md"
            >
              <Archive className="size-4" />
              Импортировать ZIP
              <ArrowRight className="size-3.5 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </button>
            <button
              type="button"
              onClick={() => setIntro('link')}
              className="group inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-sky-600/20 bg-white/80 px-3.5 text-xs font-semibold text-sky-800 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-600/35 hover:bg-white hover:shadow-md dark:bg-white/5 dark:text-sky-200 dark:hover:bg-white/10"
            >
              <Link2 className="size-4" />
              Привязать репозиторий
              <ArrowRight className="size-3.5 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </button>
          </div>
        </div>
      </div>

      <Dialog open={intro !== null} onOpenChange={(open) => !open && setIntro(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{intro ? copy[intro].title : ''}</DialogTitle>
            <DialogDescription>{intro ? copy[intro].description : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIntro(null)}>Отмена</Button>
            <Button onClick={proceed}>{intro ? copy[intro].confirm : 'Продолжить'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConnectGithubDialog open={connectOpen} onOpenChange={setConnectOpen} />
      <CreateRepoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        projectName={projectName}
      />
      <ImportProjectRepoDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectId={projectId}
        projectName={projectName}
        onImported={({ fullName, fileCount }) => {
          toast.success(`${fullName}: загружено файлов — ${fileCount}`);
        }}
      />
      <RepoPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projectId={projectId}
        currentRepoUrl={null}
      />
    </>
  );
}
