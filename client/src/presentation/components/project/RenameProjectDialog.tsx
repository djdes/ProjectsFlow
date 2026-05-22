import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '@/components/ui/sonner';
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
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { useProjects } from '@/presentation/hooks/useProjects';
import { ProjectNameAlreadyExistsError } from '@/domain/project/errors';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentName: string;
};

function normalize(s: string): string {
  return s.trim().toLocaleLowerCase('ru');
}

export function RenameProjectDialog({
  open,
  onOpenChange,
  projectId,
  currentName,
}: Props): React.ReactElement {
  const { submit, saving } = useUpdateProject();
  const { data: projects } = useProjects();
  const [name, setName] = useState(currentName);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // При открытии подставляем текущее имя; при закрытии сбрасываем ошибку.
  useEffect(() => {
    if (open) {
      setName(currentName);
      setSubmitError(null);
    }
  }, [open, currentName]);

  const trimmed = name.trim();
  const isEmpty = trimmed.length === 0;
  const isUnchanged = trimmed === currentName.trim();
  const isDuplicate =
    !isEmpty &&
    !isUnchanged &&
    (projects?.some((p) => p.id !== projectId && normalize(p.name) === normalize(trimmed)) ??
      false);
  const disabled = saving || isEmpty || isDuplicate;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitError(null);
    if (isUnchanged) {
      onOpenChange(false);
      return;
    }
    try {
      await submit(projectId, { name: trimmed });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ProjectNameAlreadyExistsError) {
        setSubmitError('Проект с таким именем уже существует');
      } else {
        toast.error('Не удалось переименовать проект');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Переименовать проект</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="renameProjectName">
              Название <span className="text-destructive">*</span>
            </Label>
            <Input
              id="renameProjectName"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(submitError) || isDuplicate}
            />
            {isDuplicate && !submitError && (
              <p className="text-xs text-muted-foreground">
                Проект с таким именем уже есть — выбери другое.
              </p>
            )}
            {submitError && <p className="text-xs text-destructive">{submitError}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={disabled}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
