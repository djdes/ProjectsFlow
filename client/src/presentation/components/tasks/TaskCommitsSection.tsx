import { useEffect, useState } from 'react';
import { Copy, ExternalLink, GitCommit, Link2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Task } from '@/domain/task/Task';
import { taskShortId } from '@/domain/task/Task';
import type { TaskCommit } from '@/domain/task/TaskCommit';
import type { GithubCommit } from '@/domain/github/GithubConnection';

type Props = {
  task: Task;
  // Колбэк дёргается при любом изменении (link/unlink) — board перефетчит counts.
  onChange: () => void;
};

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}

export function TaskCommitsSection({ task, onChange }: Props): React.ReactElement {
  const { taskRepository, githubRepository } = useContainer();
  const [linked, setLinked] = useState<TaskCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<GithubCommit[] | null>(null);
  const [linkingSha, setLinkingSha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shortId = taskShortId(task.id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    taskRepository
      .listCommits(task.projectId, task.id)
      .then((cs) => {
        if (!cancelled) setLinked(cs);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message ?? 'Не удалось загрузить коммиты');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task.projectId, task.id, taskRepository]);

  const copyShortId = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`[${shortId}]`);
      toast.success('Скопировано — вставь в commit message');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const openPicker = async (): Promise<void> => {
    setPicking(true);
    setError(null);
    try {
      const list = await githubRepository.listProjectCommits(task.projectId);
      setCandidates(list);
    } catch (e) {
      setError((e as Error).message ?? 'Не удалось загрузить список коммитов');
      setCandidates(null);
    }
  };

  const linkSha = async (sha: string): Promise<void> => {
    setLinkingSha(sha);
    setError(null);
    try {
      const c = await taskRepository.linkCommit(task.projectId, task.id, sha);
      setLinked((prev) => [c, ...prev.filter((x) => x.sha !== c.sha)]);
      onChange();
      toast.success(`Привязан ${shortSha(sha)}`);
    } catch (e) {
      setError((e as Error).message ?? 'Не удалось привязать');
    } finally {
      setLinkingSha(null);
    }
  };

  const unlink = async (sha: string): Promise<void> => {
    setError(null);
    try {
      await taskRepository.unlinkCommit(task.projectId, task.id, sha);
      setLinked((prev) => prev.filter((c) => c.sha !== sha));
      onChange();
    } catch (e) {
      setError((e as Error).message ?? 'Не удалось отвязать');
    }
  };

  const linkedShas = new Set(linked.map((c) => c.sha));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Коммиты</Label>
        <button
          type="button"
          onClick={copyShortId}
          className="group flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
          title="Скопировать short-id для commit message"
        >
          <span>[{shortId}]</span>
          <Copy className="size-3 opacity-50 group-hover:opacity-100" />
        </button>
      </div>

      {loading ? (
        <div className="h-12 animate-pulse rounded-md bg-muted" />
      ) : linked.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
          Пока ни одного коммита. Вставь <code className="font-mono">[{shortId}]</code> в&nbsp;commit
          message — авто-привяжется при «Sync commits», или привяжи руками ниже.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {linked.map((c) => (
            <li key={c.sha} className="flex items-start gap-3 px-3 py-2">
              <GitCommit className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{firstLine(c.message)}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{shortSha(c.sha)}</span>
                  <span className="mx-1">·</span>
                  {c.authorName}
                </p>
              </div>
              <a
                href={c.htmlUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Открыть на GitHub"
              >
                <ExternalLink className="size-4" />
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 text-destructive hover:text-destructive"
                onClick={() => unlink(c.sha)}
                aria-label="Отвязать коммит"
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!picking ? (
        <Button type="button" variant="outline" size="sm" onClick={openPicker}>
          <Link2 className="size-4" />
          Привязать коммит
        </Button>
      ) : candidates === null ? (
        <div className="flex items-center justify-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Загружаем коммиты…
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Последние коммиты проекта — кликни чтобы привязать.
            </p>
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                setCandidates(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Скрыть
            </button>
          </div>
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">В репозитории нет коммитов.</p>
          ) : (
            <ul className="max-h-44 divide-y overflow-y-auto rounded-md border">
              {candidates.map((c) => {
                const already = linkedShas.has(c.sha);
                return (
                  <li
                    key={c.sha}
                    className="flex items-start gap-3 px-3 py-2 hover:bg-muted/40"
                  >
                    <GitCommit className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{firstLine(c.message)}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{shortSha(c.sha)}</span>
                        <span className="mx-1">·</span>
                        {c.authorName}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={already || linkingSha === c.sha}
                      onClick={() => linkSha(c.sha)}
                    >
                      {linkingSha === c.sha ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : already ? (
                        'привязан'
                      ) : (
                        'привязать'
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Локальный Label, чтобы не тащить shadcn-Label сюда (тот импортируется через Radix и требует context).
// Минимум для визуальной сетки section header.
function Label({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
      {children}
    </span>
  );
}
