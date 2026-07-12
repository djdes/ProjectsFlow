import { useEffect, useState } from 'react';
import { Github, Lock } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { HttpError } from '@/lib/HttpError';
import { slugifyRepoName } from '@/lib/slugifyRepoName';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
};

const NAME_RE = /^[a-zA-Z0-9._-]+$/;

// «Создать новый репозиторий»: имя предзаполнено slug'ом названия проекта,
// приватность — по умолчанию включена. 422 «имя занято» показываем inline.
export function CreateRepoDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const { refresh } = useProjectsContext();
  const [name, setName] = useState('');
  const [privateRepo, setPrivateRepo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Автозаполнение при каждом открытии (название проекта могло смениться).
  useEffect(() => {
    if (open) {
      setName(slugifyRepoName(projectName));
      setPrivateRepo(true);
      setError(null);
    }
  }, [open, projectName]);

  const invalid = name.length === 0 || name.length > 100 || !NAME_RE.test(name);

  const handleCreate = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const { fullName } = await projectRepository.createRepo(projectId, { name, privateRepo });
      refresh();
      toast.success(`Репозиторий ${fullName} создан и подключён`);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof HttpError && e.body.error === 'github_repo_name_taken') {
        setError('Репозиторий с таким именем уже существует — поменяй имя.');
      } else if (e instanceof HttpError && e.body.message) {
        setError(e.body.message);
      } else {
        setError('Не удалось создать репозиторий');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-5" />
            Новый репозиторий
          </DialogTitle>
          <DialogDescription>
            Создам репозиторий на&nbsp;твоём GitHub-аккаунте и&nbsp;подключу к&nbsp;проекту.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-repo-name" className="text-sm font-medium">
              Имя репозитория
            </label>
            <Input
              id="new-repo-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              autoFocus
              spellCheck={false}
              className="font-mono"
            />
            {invalid && name.length > 0 && (
              <p className="text-xs text-destructive">
                Только латиница, цифры и&nbsp;символы . _ -
              </p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <Lock className="size-4 text-muted-foreground" />
              Приватный
            </span>
            <Switch checked={privateRepo} onCheckedChange={setPrivateRepo} />
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={saving || invalid}>
            {saving ? 'Создаю…' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
