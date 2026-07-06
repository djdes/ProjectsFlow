import { useEffect, useRef, useState } from 'react';
import { Github, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useTasks } from '@/presentation/hooks/useTasks';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { ConnectGithubDialog } from '@/presentation/components/github/ConnectGithubDialog';

type Props = {
  projectId: string;
  // Из Project — "owner/repo" или null. null = репо приложения ещё не создан → воркер не запустится.
  appRepoFullName: string | null;
  // Как у ProjectPublishedBanner: центрировать контент в видимой части при открытом окне задачи.
  shiftForOverlay?: boolean;
};

// Задачи, живущие визуально в колонке «Воркер» (todo + активные подстатусы воркера).
const WORKER_STATUSES = new Set(['todo', 'in_progress', 'awaiting_clarification']);

// Липкий гейт «Привяжите GitHub, чтобы воркер заработал». Показывается, пока в колонке «Воркер»
// есть задача И у проекта нет app-репо (self-serve воркер-раннер, M1). Гаснет, когда репо создан
// (GitHub привязан + EnsureProjectAppRepo прошёл) ИЛИ задачу убрали из колонки. Крестика нет —
// это гейт, не уведомление.
export function ProjectWorkerGateBanner({
  projectId,
  appRepoFullName,
  shiftForOverlay = false,
}: Props): React.ReactElement | null {
  const { connection } = useGithubConnection();
  const { projectRepository } = useContainer();
  const { tasks } = useTasks(projectId);
  const [connectOpen, setConnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Локально гасим сразу после успешного создания репо (Project в провайдере обновится на рефетче).
  const [done, setDone] = useState(false);
  // Флаг «после привязки GitHub надо сразу создать репо».
  const pendingEnsure = useRef(false);

  const hasWorkerTask = tasks.some((t) => WORKER_STATUSES.has(t.status));

  const ensureRepo = async (): Promise<void> => {
    setBusy(true);
    try {
      await projectRepository.ensureAppRepo(projectId);
      setDone(true);
      toast.success('Репозиторий проекта создан — воркер готов к работе');
    } catch (e) {
      toast.error(`Не удалось создать репозиторий: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      pendingEnsure.current = false;
    }
  };

  // После успешной привязки GitHub (connection появился) — если ждали, сразу создаём репо.
  useEffect(() => {
    if (connection && pendingEnsure.current && !busy && !done && !appRepoFullName) {
      void ensureRepo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  if (done || appRepoFullName || !hasWorkerTask) return null;

  const onCta = (): void => {
    if (!connection) {
      pendingEnsure.current = true;
      setConnectOpen(true);
    } else {
      void ensureRepo();
    }
  };

  return (
    <div className="relative flex min-h-[4.375rem] shrink-0 items-stretch border-b border-black/[0.05] bg-[#fff7e6] dark:border-white/[0.06] dark:bg-[#2a2413]">
      <div
        className="relative flex flex-1 flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-10 py-2 text-[13px] leading-tight text-[#7a5c00] dark:text-amber-100"
        style={shiftForOverlay ? { marginRight: 'var(--pf-drawer-open-w, 0px)' } : undefined}
      >
        <span className="truncate">
          Чтобы воркер собрал проект, нужен GitHub-репозиторий{' '}
          <span className="font-medium">— привяжите GitHub</span>.
        </span>
        <button
          type="button"
          onClick={onCta}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/30 bg-white px-2.5 py-1 text-[13px] font-medium text-[#7a5c00] shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:bg-amber-50 disabled:opacity-60 dark:border-amber-300/20 dark:bg-white/10 dark:text-amber-50 dark:hover:bg-white/20"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Github className="size-3.5" />}
          {connection ? 'Создать репозиторий' : 'Привязать GitHub'}
        </button>
      </div>

      <ConnectGithubDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
