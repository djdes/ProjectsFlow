import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Github, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import type {
  GitTokenAccessLogEntry,
  GitTokenAccessOutcome,
  GitTokenDelegation,
} from '@/application/project/ProjectRepository';
import type { Project } from '@/domain/project/Project';

type Props = {
  project: Project;
  // Только owner может включать/выключать. Не-owner видит read-only статус.
  isOwner: boolean;
  // displayName текущего диспетчера для подсказки «может через MCP получить
  // твой OAuth-токен GitHub». null если диспетчера нет.
  currentDispatcherDisplayName: string | null;
};

// Делегирование GitHub-токена owner'а проекта Ralph-диспетчеру.
// Owner ставит/снимает toggle; access-log виден ему же.
//
// Visibility:
// - Toggle/state — owner: интерактивно; не-owner: текст «owner X разрешил / не разрешил».
// - GitHub disconnected у owner'а — toggle disabled с tooltip.
// - Access-log — collapsible, грузится по клику; only owner.
export function GitTokenDelegationBlock({
  project,
  isOwner,
  currentDispatcherDisplayName,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  // GitHub-коннект ТЕКУЩЕГО юзера (если owner — он же granter). Для не-owner'а
  // используется только в подсказке «нужен ли коннект» — не важно.
  const { connection: githubConn } = useGithubConnection();
  const [delegation, setDelegation] = useState<GitTokenDelegation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<GitTokenAccessLogEntry[] | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectRepository.getGitTokenDelegation(project.id).then(
      (d) => { if (!cancelled) setDelegation(d); },
      (err: unknown) => {
        if (!cancelled) setLoadError((err as Error).message ?? 'Не удалось загрузить');
      },
    );
    return () => { cancelled = true; };
  }, [project.id, projectRepository]);

  const toggle = useCallback(async (): Promise<void> => {
    if (!delegation) return;
    setSaving(true);
    try {
      const next = await projectRepository.setGitTokenDelegation(project.id, !delegation.enabled);
      setDelegation(next);
      toast.success(next.enabled ? 'Делегация GitHub-токена включена' : 'Делегация выключена');
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }, [delegation, project.id, projectRepository]);

  const openLog = useCallback(async (): Promise<void> => {
    setLogOpen(true);
    if (log !== null) return; // уже загружали
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

  // Disabled-state для toggle: только owner может + GitHub должен быть подключён.
  // githubConn === null значит «не подключён» (provider возвращает null если нет).
  const ownerHasGithub = isOwner ? githubConn !== null : true;
  const canToggle = isOwner && ownerHasGithub && delegation !== null && !saving;
  const disabledReason = !isOwner
    ? 'Только владелец проекта может включать делегацию своего GitHub-токена'
    : !ownerHasGithub
      ? 'Сначала подключи GitHub на /profile'
      : null;

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        Ошибка загрузки: {loadError}
      </div>
    );
  }
  if (delegation === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Загрузка состояния делегации…
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Github className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">Разрешить диспетчеру использовать мой GitHub-токен</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {delegation.enabled ? (
              <>
                Включено. Текущий диспетчер{' '}
                <strong className="text-foreground">
                  {currentDispatcherDisplayName ?? '(не назначен — некому)'}
                </strong>{' '}
                может через MCP получить твой OAuth-токен GitHub для пушей в репо
                этого проекта. Снимается одним кликом.
              </>
            ) : (
              <>
                Выключено. Диспетчер не сможет пушить от твоего имени — Ralph будет
                использовать свой токен (если есть). Включи, если хочешь чтобы
                коммиты/PR шли под твоим GitHub-аккаунтом.
              </>
            )}
          </p>
          {disabledReason && (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <ShieldAlert className="size-3" />
              {disabledReason}
            </p>
          )}
        </div>
        {/* Сам toggle: кнопка с текстом. shadcn switch не используется в проекте — кнопка норм. */}
        <Button
          variant={delegation.enabled ? 'outline' : 'default'}
          size="sm"
          onClick={() => void toggle()}
          disabled={!canToggle}
          title={disabledReason ?? undefined}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {delegation.enabled ? 'Выключить' : 'Включить'}
        </Button>
      </div>

      {/* Access-log — only owner. Collapsible. */}
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

function OutcomeBadge({ outcome }: { outcome: GitTokenAccessOutcome }): React.ReactElement {
  const cfg: Record<GitTokenAccessOutcome, { label: string; cls: string }> = {
    ok: { label: 'ok', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
    not_dispatcher: {
      label: 'не диспетчер',
      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    },
    delegation_disabled: {
      label: 'делегация off',
      cls: 'bg-muted text-muted-foreground',
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
