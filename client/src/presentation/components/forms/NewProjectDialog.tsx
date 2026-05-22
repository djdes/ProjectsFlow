import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateProject } from '@/presentation/hooks/useCreateProject';
import { useProjects } from '@/presentation/hooks/useProjects';
import {
  ProjectNameAlreadyExistsError,
  ProjectNameEmptyError,
} from '@/domain/project/errors';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function normalize(s: string): string {
  return s.trim().toLocaleLowerCase('ru');
}

export function NewProjectDialog({ open, onOpenChange }: Props): React.ReactElement {
  const navigate = useNavigate();
  const { submit, saving } = useCreateProject();
  const { data: projects } = useProjects();
  const [name, setName] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Сброс формы при закрытии диалога
  useEffect(() => {
    if (!open) {
      setName('');
      setSubmitError(null);
    }
  }, [open]);

  const trimmed = name.trim();
  const isEmpty = trimmed.length === 0;
  const isDuplicate =
    !isEmpty &&
    (projects?.some((p) => normalize(p.name) === normalize(trimmed)) ?? false);
  const disabled = saving || isEmpty || isDuplicate;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitError(null);
    try {
      const project = await submit(name);
      onOpenChange(false);
      // Новый проект сразу ведём на обзор — там подключают git/KB/команду
      // (на доске задач у свежего проекта пока пусто).
      navigate(`/projects/${project.id}/overview`);
    } catch (err) {
      if (err instanceof ProjectNameAlreadyExistsError) {
        setSubmitError('Проект с таким именем уже существует');
      } else if (err instanceof ProjectNameEmptyError) {
        setSubmitError('Введите название');
      } else {
        setSubmitError('Не удалось создать проект');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый проект</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="projectName">
              Название <span className="text-destructive">*</span>
            </Label>
            <Input
              id="projectName"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(submitError) || isDuplicate}
              placeholder="acme.com"
            />
            {isDuplicate && !submitError && (
              <p className="text-xs text-muted-foreground">
                Проект с таким именем уже есть — выбери другое.
              </p>
            )}
            {submitError && (
              <p className="text-xs text-destructive">{submitError}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={disabled}>
              {saving ? 'Создаём…' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
