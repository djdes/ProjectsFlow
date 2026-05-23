import { useCallback, useEffect, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Github, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import type {
  GitTokenAccessContext,
  GitTokenAccessLogEntry,
  GitTokenAccessOutcome,
  GitTokenDelegationMember,
  GitTokenDelegationStatus,
} from '@/application/project/ProjectRepository';
import type { Project } from '@/domain/project/Project';

type Props = {
  project: Project;
  // Только owner видит блок «грантеры проекта». Не-owner видит только свой toggle.
  isOwner: boolean;
  // displayName текущего диспетчера — нужен в подсказке + чтобы отметить «caller
  // самому себе токен не отдаётся» в списке.
  currentDispatcherDisplayName: string | null;
};

// v0.15: per-member opt-in. UI разделён на 2 блока:
//   1. «Моя делегация» — toggle CALLER-а (любой member видит). Включает свой
//      собственный GitHub-токен для использования диспетчером.
//   2. «Грантеры проекта» (только owner) — упорядоченный список членов с их
//      статусами + индикацией «кто будет выбран первым».
//
// Сервер при `pf_get_project_git_token` идёт в порядке owner→displayName ASC,
// исключая caller-диспетчера. UI показывает этот порядок и помечает выбранного.
export function GitTokenDelegationBlock({
  project,
  isOwner,
  currentDispatcherDisplayName,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const { connection: githubConn } = useGithubConnection();
  const [status, setStatus] = useState<GitTokenDelegationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<GitTokenAccessLogEntry[] | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  // Manual refetch — без cancellation token'а (вызывается из toggle-обработчика;
  // если компонент к этому моменту размонтирован — React просто варнинг даст).
  const load = useCallback((): void => {
    projectRepository.getGitTokenDelegation(project.id).then(
      setStatus,
      (err: unknown) => setLoadError((err as Error).message ?? 'Не удалось загрузить'),
    );
  }, [project.id, projectRepository]);

  // Первичная загрузка С cancellation — здесь возможен размонт во время fetch'а.
  useEffect(() => {
    let cancelled = false;
    projectRepository.getGitTokenDelegation(project.id).then(
      (s) => { if (!cancelled) setStatus(s); },
      (err: unknown) => {
        if (!cancelled) setLoadError((err as Error).message ?? 'Не удалось загрузить');
      },
    );
    return () => { cancelled = true; };
  }, [project.id, projectRepository]);

  const toggleMine = async (): Promise<void> => {
    if (!status?.mine) return;
    setSaving(true);
    try {
      await projectRepository.setGitTokenDelegation(project.id, !status.mine.enabled);
      // Полный re-fetch — чтобы `all` тоже обновился у owner-а.
      load();
      toast.success(
        status.mine.enabled
          ? 'Твоя GitHub-делегация выключена'
          : 'Твоя GitHub-делегация включена',
      );
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const openLog = useCallback(async (): Promise<void> => {
    setLogOpen(true);
    if (log !== null) return;
    setLogLoading(true);
    try {
      const entries = await projectRepository.listGitTokenAccessLog(project.id);
      setLog(entries);
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось загрузить лог');
    } finally {
      setLogLoading(false);
    }
  }, [log, project.id, projectRepository]);

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        Ошибка загрузки: {loadError}
      </div>
    );
  }
  if (status === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Загрузка состояния делегации…
      </div>
    );
  }

  // === БЛОК 1: моя делегация ===
  const mine = status.mine;
  const callerHasGithub = githubConn !== null;
  const canToggleMine = mine !== null && callerHasGithub && !saving;
  const mineDisabledReason =
    mine === null
      ? 'Ты не член этого проекта — делегацию включать нельзя'
      : !callerHasGithub
        ? 'Подключи GitHub на /profile'
        : null;

  // Кто будет выбран сервером (для UI-подсказки в `all`):
  // owner первым если у него enabled+github; иначе первый по displayName ASC,
  // исключая текущего диспетчера. Считаем на клиенте по тем же правилам.
  const selectedGrantorId = computeSelected(status.all, currentDispatcherDisplayName);

  return (
    <div className="space-y-3 border-t pt-3">
      {/* Заголовок секции */}
      <div className="flex items-center gap-2">
        <Github className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium">GitHub-делегация диспетчеру</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Каждый член проекта независимо разрешает использовать свой GitHub-токен для
        git-операций в репо. Сервер при запросе диспетчером выбирает первого
        подходящего в порядке: <strong>owner → остальные по алфавиту</strong>
        {currentDispatcherDisplayName && (
          <> (текущий диспетчер <strong>{currentDispatcherDisplayName}</strong> сам себе
          токен не получит).</>
        )}
      </p>

      {/* «Моя делегация» — toggle CALLER-а */}
      <div className="rounded-md border bg-muted/10 p-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 text-sm">
            <p className="font-medium">Моя делегация</p>
            <p className="text-xs text-muted-foreground">
              {mine === null ? (
                'Ты не член этого проекта.'
              ) : mine.enabled ? (
                <>
                  Включена. Диспетчер может через MCP получить твой GitHub-токен для
                  пушей в репо. Снимается одним кликом.
                </>
              ) : (
                <>
                  Выключена. Диспетчер не получит твой токен. Включи если хочешь
                  чтобы коммиты/PR могли идти под твоим GitHub-аккаунтом.
                </>
              )}
            </p>
            {mineDisabledReason && (
              <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <ShieldAlert className="size-3" />
                {mineDisabledReason}
              </p>
            )}
          </div>
          {mine !== null && (
            <Button
              variant={mine.enabled ? 'outline' : 'default'}
              size="sm"
              onClick={() => void toggleMine()}
              disabled={!canToggleMine}
              title={mineDisabledReason ?? undefined}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {mine.enabled ? 'Выключить' : 'Включить'}
            </Button>
          )}
        </div>
      </div>

      {/* === БЛОК 2: грантеры проекта === (только owner) */}
      {isOwner && status.all.length > 0 && (
        <div className="rounded-md border bg-card p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Bot className="size-3.5 text-muted-foreground" />
            Грантеры этого проекта
          </p>
          <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
            Порядок выбора сервером сверху вниз. Owner идёт первым, дальше — по
            алфавиту. Диспетчер сам исключается из кандидатов.
          </p>
          <ul className="divide-y rounded-md border bg-muted/5">
            {status.all.map((m, idx) => (
              <GrantorRow
                key={m.granterUserId}
                m={m}
                index={idx + 1}
                isSelected={m.granterUserId === selectedGrantorId}
                isCurrentDispatcher={m.displayName === currentDispatcherDisplayName}
              />
            ))}
          </ul>
          {selectedGrantorId === null && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              ⚠ Сейчас никто не будет выбран — все включённые грантеры либо без GH,
              либо являются текущим диспетчером.
            </p>
          )}
        </div>
      )}

      {/* Access-log — only owner. */}
      {isOwner && (
        <div>
          {!logOpen ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void openLog()}
            >
              <ChevronRight className="size-3" />
              Показать лог обращений
            </button>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setLogOpen(false)}
              >
                <ChevronDown className="size-3" />
                Скрыть лог
              </button>
              {logLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Загрузка…
                </div>
              ) : log === null || log.length === 0 ? (
                <p className="rounded-md border border-dashed bg-muted/10 p-3 text-center text-xs text-muted-foreground">
                  Обращений ещё не было.
                </p>
              ) : (
                <ul className="divide-y rounded-md border bg-card text-xs">
                  {log.map((e, idx) => (
                    <li
                      key={`${e.accessedAt}-${idx}`}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="font-mono text-muted-foreground">
                        {new Date(e.accessedAt).toLocaleString('ru-RU')}
                      </span>
                      <span className="flex-1 truncate text-foreground">
                        {e.accessedByDisplayName ?? e.accessedByUserId.slice(0, 8)}
                      </span>
                      <ContextBadge context={e.context} />
                      <OutcomeBadge outcome={e.outcome} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GrantorRow({
  m,
  index,
  isSelected,
  isCurrentDispatcher,
}: {
  m: GitTokenDelegationMember;
  index: number;
  isSelected: boolean;
  isCurrentDispatcher: boolean;
}): React.ReactElement {
  const reasonNotSelected =
    !m.enabled ? 'не разрешено'
    : !m.githubLogin ? 'нет GitHub'
    : isCurrentDispatcher ? 'это и есть диспетчер'
    : null;

  return (
    <li className="flex items-center gap-2 px-3 py-2 text-xs">
      <span className="w-4 shrink-0 text-muted-foreground">{index}.</span>
      <span className="flex-1 truncate font-medium">
        {m.displayName}
        {m.isOwner && (
          <span className="ml-1.5 rounded bg-primary/15 px-1 text-[10px] font-medium uppercase tracking-wide text-primary">
            owner
          </span>
        )}
        {isCurrentDispatcher && (
          <span className="ml-1.5 rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            dispatcher
          </span>
        )}
      </span>
      <span className="text-muted-foreground">
        github:{' '}
        {m.githubLogin ? (
          <span className="text-foreground">{m.githubLogin}</span>
        ) : (
          <span className="italic">нет</span>
        )}
      </span>
      {isSelected ? (
        <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
          ✓ выбран
        </span>
      ) : (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
            m.enabled
              ? 'bg-muted text-muted-foreground'
              : 'bg-muted/40 text-muted-foreground'
          }`}
        >
          {reasonNotSelected ?? (m.enabled ? 'ok' : '—')}
        </span>
      )}
    </li>
  );
}

// Определить какого члена сервер выберет первым: owner если eligible, иначе
// первый по displayName ASC (`all` уже отсортирован сервером в этом порядке).
// Eligible = enabled && githubLogin && !isCurrentDispatcher.
function computeSelected(
  all: GitTokenDelegationMember[],
  currentDispatcherDisplayName: string | null,
): string | null {
  const dispatcherName = currentDispatcherDisplayName;
  const eligible = (m: GitTokenDelegationMember): boolean =>
    m.enabled && m.githubLogin !== null && m.displayName !== dispatcherName;
  const ownerMember = all.find((m) => m.isOwner);
  if (ownerMember && eligible(ownerMember)) return ownerMember.granterUserId;
  const next = all.find((m) => !m.isOwner && eligible(m));
  return next?.granterUserId ?? null;
}

// v0.16+: context показывает «для чего брали токен». Помогает owner'у понять
// картину: «git_token_fetch» — диспетчер запросил для своих git-команд;
// «link_commit/sync_commits» — сервер автоматически использовал при привязке
// коммитов; «kb_write» — при записи в KB.
function ContextBadge({
  context,
}: {
  context: GitTokenAccessContext | null;
}): React.ReactElement | null {
  if (context === null) return null;
  const labels: Record<GitTokenAccessContext, string> = {
    git_token_fetch: 'fetch',
    link_commit: 'link',
    sync_commits: 'sync',
    kb_write: 'kb',
  };
  return (
    <span
      className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
      title={`context: ${context}`}
    >
      {labels[context]}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: GitTokenAccessOutcome }): React.ReactElement {
  const cfg: Record<GitTokenAccessOutcome, { label: string; cls: string }> = {
    ok: { label: 'ok', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
    not_dispatcher: {
      label: 'не диспетчер',
      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    },
    delegation_disabled: {
      label: 'нет грантеров',
      cls: 'bg-muted text-muted-foreground',
    },
    no_eligible_grantor: {
      label: 'без github',
      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    },
    granter_github_disconnected: {
      label: 'github отключён',
      cls: 'bg-muted text-muted-foreground',
    },
    granter_not_owner_anymore: {
      label: 'не owner',
      cls: 'bg-muted text-muted-foreground',
    },
  };
  const c = cfg[outcome];
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${c.cls}`}>
      {c.label}
    </span>
  );
}
