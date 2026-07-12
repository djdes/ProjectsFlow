import { useEffect, useState } from 'react';
import { ExternalLink, GitCommit, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GithubCommit } from '@/domain/github/GithubConnection';
import { useContainer } from '@/infrastructure/di/container';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { HttpError } from '@/lib/HttpError';
import { OverviewSection } from '@/presentation/components/project/OverviewSection';

type Props = {
  projectId: string;
  gitRepoUrl: string;
};

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}с назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} дн назад`;
  return d.toLocaleDateString('ru');
}

export function RecentCommitsSection({ projectId, gitRepoUrl }: Props): React.ReactElement {
  const { githubRepository } = useContainer();
  const { connection, loading: connLoading } = useGithubConnection();
  const [commits, setCommits] = useState<GithubCommit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGithubUrl = /github\.com[/:]([^/\s]+)\/([^/\s.]+)/.test(gitRepoUrl);

  const load = (): void => {
    setLoading(true);
    setError(null);
    githubRepository
      .listProjectCommits(projectId)
      .then((c) => setCommits(c))
      .catch((e: unknown) => {
        if (e instanceof HttpError) {
          if (e.status === 409) setError('Подключи GitHub чтобы видеть коммиты.');
          else if (e.status === 422) setError('URL репозитория не выглядит как GitHub.');
          else if (e.body.error === 'github_api_error') {
            const upstream = (e.body.details as { upstreamStatus?: number } | undefined)?.upstreamStatus;
            const hint =
              upstream === 404 ? 'Репо не найден или у токена нет к нему доступа. Если репо приватный — переподключи GitHub чтобы обновить scope.' :
              upstream === 401 ? 'GitHub-токен невалиден — переподключи GitHub.' :
              upstream === 403 ? 'GitHub отказал в доступе (rate limit или token scope).' :
              'GitHub API вернул ошибку.';
            setError(`${hint} (HTTP ${upstream ?? '?'})\n${e.body.message ?? ''}`);
          }
          else setError(e.message);
        } else {
          setError('Не удалось загрузить коммиты.');
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (connLoading || !connection || !isGithubUrl) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, projectId, gitRepoUrl, isGithubUrl, connLoading]);

  if (!isGithubUrl) {
    return (
      <OverviewSection
        icon={<GitCommit className="size-4 text-muted-foreground" />}
        title="Последние коммиты"
      >
        <p className="text-sm text-muted-foreground">
          Отслеживание коммитов работает только для GitHub-репозиториев.
        </p>
      </OverviewSection>
    );
  }

  if (connLoading) return <></>;

  if (!connection) {
    return (
      <OverviewSection
        icon={<GitCommit className="size-4 text-muted-foreground" />}
        title="Последние коммиты"
      >
        <p className="text-sm text-muted-foreground">
          Подключи GitHub-аккаунт, чтобы видеть коммиты. Кнопка в секции выше.
        </p>
      </OverviewSection>
    );
  }

  return (
    <OverviewSection
      icon={<GitCommit className="size-4 text-muted-foreground" />}
      title="Последние коммиты"
      actions={
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} aria-label="Обновить">
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
        </Button>
      }
    >
      {loading && commits === null && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted" />
          ))}
        </div>
      )}

      {error && <p className="whitespace-pre-line text-sm text-destructive">{error}</p>}

      {!loading && !error && commits !== null && commits.length === 0 && (
        <p className="text-sm text-muted-foreground">В репозитории нет коммитов.</p>
      )}

      {commits !== null && commits.length > 0 && (
        <ul className="space-y-2">
          {commits.map((c) => (
            <li key={c.sha} className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/40">
              {c.authorAvatarUrl ? (
                <img
                  src={c.authorAvatarUrl}
                  alt={c.authorName}
                  className="mt-0.5 size-6 shrink-0 rounded-full"
                  loading="lazy"
                />
              ) : (
                <div className="mt-0.5 size-6 shrink-0 rounded-full bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.message.split('\n')[0]}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{shortSha(c.sha)}</span>
                  <span className="mx-1">·</span>
                  {c.authorName}
                  <span className="mx-1">·</span>
                  {relativeTime(c.committedAt)}
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
            </li>
          ))}
        </ul>
      )}
    </OverviewSection>
  );
}
