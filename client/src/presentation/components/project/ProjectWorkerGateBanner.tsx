import { useEffect, useRef, useState } from 'react';
import { Github, Loader2, Wrench } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useTasks } from '@/presentation/hooks/useTasks';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { ConnectGithubDialog } from '@/presentation/components/github/ConnectGithubDialog';
import type { KbKind } from '@/domain/project/Project';

type Props = {
  projectId: string;
  gitRepoUrl: string | null;
  // Из Project — "owner/repo" или null. null = репо приложения ещё не создан.
  appRepoFullName: string | null;
  // Из Project. 'none' = базы знаний нет → диспетчер СКИПАЕТ проект.
  kbKind: KbKind;
  // Как у ProjectPublishedBanner: центрировать контент в видимой части при открытом окне задачи.
  shiftForOverlay?: boolean;
};

// Задачи, живущие визуально в колонке «Воркер» (todo + активные подстатусы воркера).
const WORKER_STATUSES = new Set(['todo', 'in_progress', 'awaiting_clarification']);

// Липкий гейт готовности воркера. Показывается, пока в колонке «Воркер» есть задача И воркер
// настроен НЕ полностью. «Настроен» = три условия (self-serve воркер-раннер):
//   1) app-репо создан (есть куда писать код),
//   2) делегация GitHub-токена включена (диспетчер клонирует/пушит приватный репо),
//   3) заведена база знаний (иначе диспетчер скипает проект).
// Одна кнопка «Настроить/Донастроить» дожимает всё разом (EnsureProjectAppRepo идемпотентно
// создаёт репо + включает делегацию + заводит локальную KB). Крестика нет — это гейт, не
// уведомление: пока не настроено, кидать задачу воркеру бессмысленно.
export function ProjectWorkerGateBanner({
  projectId,
  gitRepoUrl,
  appRepoFullName,
  kbKind,
  shiftForOverlay = false,
}: Props): React.ReactElement | null {
  const { connection } = useGithubConnection();
  const { projectRepository } = useContainer();
  const { tasks } = useTasks(projectId);
  const [connectOpen, setConnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Локально гасим сразу после успешной настройки (Project в провайдере обновится на рефетче).
  const [done, setDone] = useState(false);
  // null = ещё не знаем/не грузили (репо нет — делегация неактуальна).
  const [delegationEnabled, setDelegationEnabled] = useState<boolean | null>(null);
  // Флаг «после привязки GitHub надо сразу настроить».
  const pendingEnsure = useRef(false);

  const hasWorkerTask = tasks.some((t) => WORKER_STATUSES.has(t.status));

  // Статус делегации подтягиваем, только когда репо уже есть и есть воркер-задача
  // (без репо гейт и так про GitHub, лишний запрос не нужен).
  useEffect(() => {
    if (!appRepoFullName || !hasWorkerTask) {
      setDelegationEnabled(null);
      return;
    }
    let cancelled = false;
    projectRepository
      .getGitTokenDelegation(projectId)
      .then((s) => {
        if (!cancelled) setDelegationEnabled(Boolean(s.mine?.enabled) || s.all.some((m) => m.enabled));
      })
      .catch(() => {
        if (!cancelled) setDelegationEnabled(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId, appRepoFullName, hasWorkerTask]);

  const ensure = async (): Promise<void> => {
    setBusy(true);
    try {
      await projectRepository.ensureAppRepo(projectId);
      setDone(true);
      toast.success('Воркер настроен: репозиторий, делегация и база знаний готовы');
    } catch (e) {
      toast.error(`Не удалось настроить воркера: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      pendingEnsure.current = false;
    }
  };

  // После успешной привязки GitHub (connection появился) — если ждали, сразу настраиваем.
  useEffect(() => {
    if (connection && pendingEnsure.current && !busy && !done) {
      void ensure();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  const needRepo = !appRepoFullName;
  const needKb = kbKind === 'none';
  // Делегацию флагуем «нужной», только когда ТОЧНО знаем, что выключена (не в null-загрузке).
  const needDelegation = Boolean(appRepoFullName) && delegationEnabled === false;
  const somethingMissing = needRepo || needKb || needDelegation;

  // Пока GitHub вообще не подключён, onboarding-плашка проекта уже даёт три понятных
  // сценария. Не дублируем её старой кнопкой после отправки задачи воркеру.
  if (!gitRepoUrl || done || !hasWorkerTask || !somethingMissing) return null;

  const onCta = (): void => {
    if (!connection) {
      pendingEnsure.current = true;
      setConnectOpen(true);
    } else {
      void ensure();
    }
  };

  // Текст: без репо — акцент на GitHub; с репо — что именно осталось донастроить.
  const missingLabels: string[] = [];
  if (needDelegation) missingLabels.push('включить делегацию GitHub-токена');
  if (needKb) missingLabels.push('создать базу знаний');
  const message = needRepo
    ? 'Чтобы воркер собрал проект, нужен GitHub-репозиторий — привяжите GitHub.'
    : `Воркер почти готов — осталось: ${missingLabels.join(' и ')}.`;
  const ctaLabel = needRepo ? (connection ? 'Настроить воркера' : 'Привязать GitHub') : 'Донастроить';
  const CtaIcon = needRepo ? Github : Wrench;

  return (
    <div className="relative flex min-h-[4.375rem] shrink-0 items-stretch border-b border-black/[0.05] bg-[#fff7e6] dark:border-white/[0.06] dark:bg-[#2a2413]">
      <div
        className="relative flex flex-1 flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-10 py-2 text-[13px] leading-tight text-[#7a5c00] dark:text-amber-100"
        style={shiftForOverlay ? { marginRight: 'var(--pf-drawer-open-w, 0px)' } : undefined}
      >
        <span className="truncate">{message}</span>
        <button
          type="button"
          onClick={onCta}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/30 bg-white px-2.5 py-1 text-[13px] font-medium text-[#7a5c00] shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:bg-amber-50 disabled:opacity-60 dark:border-amber-300/20 dark:bg-white/10 dark:text-amber-50 dark:hover:bg-white/20"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CtaIcon className="size-3.5" />}
          {ctaLabel}
        </button>
      </div>

      <ConnectGithubDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
