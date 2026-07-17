import { useEffect, useState } from 'react';
import { Archive, ArrowRight, Github, Link2, Loader2, Play, Sparkles } from 'lucide-react';
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
import { useContainer } from '@/infrastructure/di/container';
import { cn } from '@/lib/utils';

type Action = 'create' | 'import' | 'link';

type Props = {
  projectId: string;
  projectName: string;
  shiftForOverlay?: boolean;
};

const copy: Record<Action, { title: string; description: string; confirm: string }> = {
  create: {
    title: 'Создать репозиторий на GitHub?',
    description: 'Создадим новый приватный репозиторий и сразу подключим его к проекту.',
    confirm: 'Настроить репозиторий',
  },
  import: {
    title: 'Импортировать готовый проект?',
    description: 'Ты выберешь ZIP и куда его загрузить: в новый или уже существующий пустой GitHub-репозиторий.',
    confirm: 'Выбрать ZIP',
  },
  link: {
    title: 'Подключить существующий репозиторий?',
    description: 'Выберем репозиторий из твоего GitHub и сделаем его рабочим для этого проекта.',
    confirm: 'Выбрать репозиторий',
  },
};

export function ProjectGithubOnboardingBanner({
  projectId,
  projectName,
  shiftForOverlay = false,
}: Props): React.ReactElement | null {
  const { connection } = useGithubConnection();
  const { user } = useCurrentUser();
  const { taskRepository } = useContainer();
  const [hidden, setHidden] = useState(false);
  const [intro, setIntro] = useState<Action | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);

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

  const connected = (): void => setHidden(true);

  const createLaunchTask = async (): Promise<void> => {
    if (!user) return;
    setLaunchBusy(true);
    try {
      await taskRepository.create(projectId, {
        description: 'Запустить проект',
        status: 'todo',
        assigneeUserId: user.id,
      });
      toast.success('Задача «Запустить проект» добавлена воркеру');
      setLaunchOpen(false);
    } catch {
      toast.error('Не удалось создать задачу');
    } finally {
      setLaunchBusy(false);
    }
  };

  if (hidden) return null;

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
              Начните с чистого репозитория, импортируйте ZIP или продолжите работу в существующем.
            </p>
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
        onCreated={connected}
      />
      <ImportProjectRepoDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectId={projectId}
        projectName={projectName}
        onImported={({ fullName, fileCount }) => {
          connected();
          toast.success(`${fullName}: загружено файлов — ${fileCount}`);
          setLaunchOpen(true);
        }}
      />
      <RepoPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projectId={projectId}
        currentRepoUrl={null}
        onLinked={connected}
      />

      <Dialog open={launchOpen} onOpenChange={(open) => !launchBusy && setLaunchOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={cn('grid size-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600')}>
                <Play className="size-4 fill-current" />
              </span>
              Теперь запустите проект
            </DialogTitle>
            <DialogDescription>
              Создадим задачу «Запустить проект» прямо в канбане воркера — он проверит импорт и подготовит запуск.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={launchBusy} onClick={() => setLaunchOpen(false)}>Не сейчас</Button>
            <Button disabled={launchBusy || !user} onClick={() => void createLaunchTask()}>
              {launchBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
              Создать задачу
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
