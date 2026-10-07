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
import { ProjectBannerDismissButton } from './ProjectBannerDismissButton';
import { useProjectBannersHidden } from './projectBannersSetting';
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

// Задача запуска опознаётся по маркеру в брифе (его ставит сервер) либо, для задач,
// созданных до появления брифа, по заголовку из двух слов. Заголовок теперь приходит
// markdown-заголовком `# …`, поэтому решётки снимаем.
const LAUNCH_TASK_MARKER = '<!-- pf:launch-project -->';

function isLaunchProjectTask(task: Task): boolean {
  const description = task.description ?? '';
  if (description.includes(LAUNCH_TASK_MARKER)) return true;
  const title = description
    .split(/\r?\n/, 1)[0]
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU');
  return title === 'запустить проект';
}

function ProjectLaunchBanner({ projectId, shiftForOverlay = false }: LaunchBannerProps): React.ReactElement {
  const { user } = useCurrentUser();
  const { projectRepository } = useContainer();
  const { tasks, loading, refetch } = useTasks(projectId);
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
      // Текст задачи собирает сервер: только у него есть site_slug проекта и контракт
      // публикации артефакта. Клиентская задача «Запустить проект» из двух слов приводила
      // к тому, что воркер принимал зелёную сборку за запуск и закрывал задачу.
      const result = await projectRepository.launchProject(projectId);
      await refetch();
      toast.success(
        result.created
          ? 'Задача «Запустить проект» добавлена воркеру'
          : 'Задача «Запустить проект» уже в работе',
      );
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
      <div data-pf-project-setup className="relative border-b border-primary/10 bg-primary/[0.04] px-4 py-3 sm:px-8 sm:pr-24">
        <ProjectBannerDismissButton className="right-1 top-1 size-11 rounded-lg sm:right-16 sm:top-2 sm:size-7" />
        <div
          className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 pr-7 transition-[margin] duration-300"
          style={shiftForOverlay ? { marginRight: 'var(--pf-drawer-open-w, 0px)' } : undefined}
        >
          <div className="flex min-w-0 basis-full items-center gap-3 sm:flex-1 sm:basis-64">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Rocket className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Код подключён</div>
              <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Воркер проверит проект и опубликует результат.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            disabled={loading || Boolean(activeLaunchTask)}
            onClick={() => setLaunchOpen(true)}
            className="group ml-12 min-h-11 shrink-0 gap-2 rounded-lg px-3 text-xs sm:ml-0 sm:min-h-9"
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
          </Button>
        </div>
      </div>

      <Dialog open={launchOpen} onOpenChange={(open) => !launchBusy && setLaunchOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
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
  // Общая настройка «плашки скрыты» — та же, что включает крестик и тумблер в меню «⋯».
  // Гейт продублирован здесь, чтобы плашка гасла независимо от места рендера.
  const bannersHidden = useProjectBannersHidden();
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

  if (bannersHidden) return null;

  if (gitRepoUrl) {
    if (siteState !== 'pending') return null;
    return <ProjectLaunchBanner projectId={projectId} shiftForOverlay={shiftForOverlay} />;
  }

  return (
    <>
      <div className="relative border-b border-primary/10 bg-primary/[0.04] px-4 py-3 pr-12 sm:px-8 sm:pr-24">
        <ProjectBannerDismissButton className="right-1 top-1 size-11 rounded-lg sm:right-16 sm:top-2 sm:size-7" />
        <div
          className="mx-auto flex max-w-[1180px] flex-col gap-3 transition-[margin] duration-300 xl:flex-row xl:items-center xl:justify-between"
          style={shiftForOverlay ? { marginRight: 'var(--pf-drawer-open-w, 0px)' } : undefined}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white shadow-sm ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
                <Sparkles className="size-3.5 text-primary" />
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
              className="group inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
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
