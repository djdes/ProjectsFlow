import { useEffect, useRef, useState } from 'react';
import { Archive, FileArchive, Loader2, Lock, UploadCloud } from 'lucide-react';
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
import { useContainer } from '@/infrastructure/di/container';
import { slugifyRepoName } from '@/lib/slugifyRepoName';
import { cn } from '@/lib/utils';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  onImported: (result: { fullName: string; gitRepoUrl: string; fileCount: number }) => void;
};

const NAME_RE = /^[a-zA-Z0-9._-]+$/;

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
  const [archive, setArchive] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(slugifyRepoName(projectName));
    setPrivateRepo(true);
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
        { name, privateRepo, archive },
        setProgress,
      );
      refresh();
      onOpenChange(false);
      onImported(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось импортировать проект');
    } finally {
      setSaving(false);
    }
  };

  const invalidName = !name || name.length > 100 || !NAME_RE.test(name);
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="size-5 text-violet-600" />
            Импортировать проект
          </DialogTitle>
          <DialogDescription>
            Распакуем ZIP, создадим репозиторий и загрузим файлы одним аккуратным коммитом.
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
          <div className="space-y-1.5">
            <label htmlFor="import-repo-name" className="text-sm font-medium">Имя репозитория</label>
            <Input id="import-repo-name" value={name} onChange={(e) => setName(e.target.value)} className="font-mono" />
          </div>
          <label className="flex cursor-pointer items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Lock className="size-4 text-muted-foreground" />Приватный</span>
            <Switch checked={privateRepo} onCheckedChange={setPrivateRepo} />
          </label>
          {saving && (
            <div className="space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-violet-600 transition-[width]" style={{ width: `${Math.max(8, progress)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{progress < 100 ? `Загружаем ZIP · ${progress}%` : 'Распаковываем и создаём репозиторий…'}</p>
            </div>
          )}
          {invalidName && name && <p className="text-xs text-destructive">Только латиница, цифры и символы . _ -</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button disabled={saving || !archive || invalidName} onClick={() => void submit()}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Импортировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
