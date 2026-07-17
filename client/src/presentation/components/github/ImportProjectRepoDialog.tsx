import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  FileArchive,
  FolderGit2,
  Github,
  Loader2,
  Lock,
  ShieldCheck,
  UploadCloud,
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
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { GithubRepoSummary } from '@/domain/github/GithubConnection';
import { useContainer } from '@/infrastructure/di/container';
import { HttpError } from '@/lib/HttpError';
import { slugifyRepoName } from '@/lib/slugifyRepoName';
import { cn } from '@/lib/utils';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { RepoPickerDialog } from './RepoPickerDialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  onImported: (result: { fullName: string; gitRepoUrl: string; fileCount: number }) => void;
};

const NAME_RE = /^[a-zA-Z0-9._-]+$/;
type TargetMode = 'new' | 'existing';
type RepoChoice = Pick<GithubRepoSummary, 'fullName' | 'htmlUrl'> & {
  readonly private?: boolean;
};

function emptyRepoFromError(error: HttpError): RepoChoice | null {
  if (error.body.error !== 'github_empty_repo_exists') return null;
  const details = error.body.details;
  if (!details || typeof details !== 'object' || !('repo' in details)) return null;
  const repo = (details as { repo?: unknown }).repo;
  if (!repo || typeof repo !== 'object') return null;
  const { fullName, htmlUrl } = repo as { fullName?: unknown; htmlUrl?: unknown };
  return typeof fullName === 'string' && typeof htmlUrl === 'string'
    ? { fullName, htmlUrl }
    : null;
}

export function ImportProjectRepoDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  onImported,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const { refresh } = useProjectsContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [privateRepo, setPrivateRepo] = useState(true);
  const [targetMode, setTargetMode] = useState<TargetMode>('new');
  const [selectedRepo, setSelectedRepo] = useState<RepoChoice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reusedExisting, setReusedExisting] = useState(false);
  const [archive, setArchive] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(slugifyRepoName(projectName));
    setPrivateRepo(true);
    setTargetMode('new');
    setSelectedRepo(null);
    setPickerOpen(false);
    setReusedExisting(false);
    setArchive(null);
    setProgress(0);
    setError(null);
  }, [open, projectName]);

  const choose = (file: File | undefined): void => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Выбери ZIP-архив');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError('ZIP больше 25 МБ');
      return;
    }
    setArchive(file);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    if (!archive) return;
    setSaving(true);
    setError(null);
    try {
      const result = await projectRepository.importRepo(
        projectId,
        targetMode === 'new'
          ? { targetMode: 'new', name, privateRepo, archive }
          : {
            targetMode: 'existing',
            existingRepoFullName: selectedRepo!.fullName,
            archive,
          },
        setProgress,
      );
      refresh();
      onOpenChange(false);
      onImported(result);
    } catch (cause) {
      if (cause instanceof HttpError) {
        const existing = emptyRepoFromError(cause);
        if (existing) {
          setSelectedRepo(existing);
          setTargetMode('existing');
          setReusedExisting(true);
          setProgress(0);
          setError(null);
          return;
        }
      }
      setError(cause instanceof Error ? cause.message : 'Не удалось импортировать проект');
    } finally {
      setSaving(false);
    }
  };

  const invalidName = !name || name.length > 100 || !NAME_RE.test(name);
  const targetMissing = targetMode === 'existing' && !selectedRepo;
  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="size-5 text-violet-600" />
            Импортировать проект
          </DialogTitle>
          <DialogDescription>
            Распакуем ZIP и загрузим его одним коммитом — в новый или уже существующий пустой репозиторий.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              choose(event.dataTransfer.files[0]);
            }}
            className={cn(
              'flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-5 py-7 text-center transition-colors',
              dragging ? 'border-violet-500 bg-violet-500/10' : 'border-border bg-muted/30 hover:bg-muted/60',
            )}
          >
            {archive ? <FileArchive className="size-8 text-violet-600" /> : <UploadCloud className="size-8 text-muted-foreground" />}
            <span className="max-w-full truncate text-sm font-medium">
              {archive?.name ?? 'Перетащи ZIP сюда или выбери файл'}
            </span>
            <span className="text-xs text-muted-foreground">ZIP до 25 МБ · распакованный проект до 100 МБ</span>
          </button>
          <input ref={inputRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => choose(e.target.files?.[0])} />

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => {
                setTargetMode('new');
                setReusedExisting(false);
                setError(null);
              }}
              className={cn(
                'flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium transition',
                targetMode === 'new' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Github className="size-4" />
              Новый репозиторий
            </button>
            <button
              type="button"
              onClick={() => {
                setTargetMode('existing');
                setReusedExisting(false);
                setError(null);
              }}
              className={cn(
                'flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium transition',
                targetMode === 'existing' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <FolderGit2 className="size-4" />
              Существующий пустой
            </button>
          </div>

          {targetMode === 'new' ? (
            <>
              <div className="space-y-1.5">
                <label htmlFor="import-repo-name" className="text-sm font-medium">Имя репозитория</label>
                <Input id="import-repo-name" value={name} onChange={(e) => setName(e.target.value)} className="font-mono" />
              </div>
              <label className="flex cursor-pointer items-center justify-between text-sm">
                <span className="flex items-center gap-2"><Lock className="size-4 text-muted-foreground" />Приватный</span>
                <Switch checked={privateRepo} onCheckedChange={setPrivateRepo} />
              </label>
            </>
          ) : (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-12 w-full justify-start gap-3 px-3 py-2.5 text-left"
                onClick={() => setPickerOpen(true)}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                  <FolderGit2 className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">
                    {selectedRepo ? 'Загрузить ZIP в' : 'Выбрать репозиторий'}
                  </span>
                  <span className="block truncate font-mono text-sm">
                    {selectedRepo?.fullName ?? 'Только репозиторий без коммитов'}
                  </span>
                </span>
                {selectedRepo?.private && <Lock className="size-3.5 text-muted-foreground" />}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Перед импортом проверим права и пустоту ещё раз. Если в репозитории появился commit, ничего не перезапишем.
              </p>
            </div>
          )}

          {reusedExisting && selectedRepo && (
            <div className="flex gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium text-foreground">Нашли твой пустой репозиторий</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Переключили импорт на <span className="font-mono text-foreground">{selectedRepo.fullName}</span>. Подтверди загрузку кнопкой ниже.
                </p>
              </div>
            </div>
          )}
          {saving && (
            <div className="space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-violet-600 transition-[width]" style={{ width: `${Math.max(8, progress)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress < 100
                  ? `Загружаем ZIP · ${progress}%`
                  : targetMode === 'new'
                    ? 'Распаковываем и создаём репозиторий…'
                    : 'Проверяем репозиторий и создаём import-коммит…'}
              </p>
            </div>
          )}
          {targetMode === 'new' && invalidName && name && <p className="text-xs text-destructive">Только латиница, цифры и символы . _ -</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button disabled={saving || !archive || targetMissing || (targetMode === 'new' && invalidName)} onClick={() => void submit()}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {targetMode === 'existing' && selectedRepo
              ? `Импортировать в ${selectedRepo.fullName.split('/').at(-1)}`
              : 'Импортировать'}
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
      <RepoPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projectId={projectId}
        currentRepoUrl={null}
        selectionOnly
        onSelected={(repo) => {
          setSelectedRepo(repo);
          setReusedExisting(false);
          setError(null);
        }}
      />
    </>
  );
}
