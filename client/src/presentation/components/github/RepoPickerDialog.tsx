import { useEffect, useMemo, useState } from 'react';
import { Github, Lock, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import type { GithubRepoSummary } from '@/domain/github/GithubConnection';
import { useContainer } from '@/infrastructure/di/container';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentRepoUrl: string | null;
  onCreateNew?: () => void;
};

function formatPushed(d: Date | null): string {
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return 'сегодня';
  if (days < 30) return `${days} дн назад`;
  if (days < 365) return `${Math.floor(days / 30)} мес назад`;
  return d.toLocaleDateString('ru');
}

export function RepoPickerDialog({
  open,
  onOpenChange,
  projectId,
  currentRepoUrl,
  onCreateNew,
}: Props): React.ReactElement {
  const { githubRepository } = useContainer();
  const { submit: updateProject, saving } = useUpdateProject();
  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Загружаем список при открытии
  useEffect(() => {
    if (!open) {
      setQuery('');
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    githubRepository
      .listUserRepos()
      .then((r) => setRepos(r))
      .catch(() => setError('Не удалось загрузить список репозиториев. Проверь подключение GitHub.'))
      .finally(() => setLoading(false));
  }, [open, githubRepository]);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [repos, query]);

  const handlePick = async (repo: GithubRepoSummary): Promise<void> => {
    try {
      await updateProject(projectId, { gitRepoUrl: repo.htmlUrl });
      toast.success(`Репо ${repo.fullName} подключено`);
      onOpenChange(false);
    } catch {
      toast.error('Не удалось сохранить выбор');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-5" />
            Выбор репозитория
          </DialogTitle>
          <DialogDescription>
            Покажу до&nbsp;100 твоих последних активных репо. Поиск работает по&nbsp;имени и&nbsp;описанию.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск…"
              className="pl-8"
              autoFocus
            />
          </div>

          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {!loading && !error && filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {repos === null || repos.length === 0
                ? 'У&nbsp;тебя пока нет репозиториев на&nbsp;GitHub.'
                : 'Ничего не&nbsp;найдено.'}
            </p>
          )}

          {filtered.length > 0 && (
            <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {filtered.map((repo) => {
                const isCurrent = currentRepoUrl === repo.htmlUrl;
                return (
                  <li key={repo.id}>
                    <button
                      type="button"
                      disabled={saving || isCurrent}
                      onClick={() => handlePick(repo)}
                      className="group flex w-full flex-col items-start gap-1 rounded-md border bg-card p-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="flex w-full items-center gap-2">
                        <span className="truncate font-mono text-sm font-medium">
                          {repo.fullName}
                        </span>
                        {repo.private && (
                          <Lock
                            className="size-3 shrink-0 text-muted-foreground"
                            aria-label="Приватный"
                          />
                        )}
                        {isCurrent && (
                          <span className="ml-auto rounded-md border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                            подключён
                          </span>
                        )}
                      </div>
                      {repo.description && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {repo.description}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        {repo.pushedAt && `обновлён ${formatPushed(repo.pushedAt)}`}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {onCreateNew ? (
            <Button type="button" variant="outline" onClick={onCreateNew}>
              Создать новый
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
