import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  // Сколько ДРУГИХ участников (кроме самого юзера) есть у проекта. Используется
  // чтобы показать предупреждение про потерю их доступа и nudge'нуть на «передать
  // владение» вместо удаления. 0 — одиночный проект, без warning'а.
  otherMemberCount: number;
  // Вызывается после успешного удаления — родитель чистит state и редиректит.
  onDeleted: () => void;
};

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  otherMemberCount,
  onDeleted,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await projectRepository.delete(projectId);
      toast.success(`Проект «${projectName}» удалён`);
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось удалить проект');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Удалить проект навсегда?
          </DialogTitle>
          <DialogDescription>
            Вы действительно хотите безвозвратно удалить проект{' '}
            <strong className="text-foreground">«{projectName}»</strong>?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p>Это действие необратимо. Будут удалены:</p>
          <ul className="ml-5 list-disc text-muted-foreground space-y-0.5">
            <li>задачи, комментарии и привязки коммитов</li>
            <li>локальные KB-документы и секреты в vault</li>
            <li>финансовые записи (расходы, доходы, начисления)</li>
            <li>приглашения и заявки на вступление</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Подключённый GitHub-репозиторий <strong>не удаляется</strong> — управляйте им
            на GitHub отдельно.
          </p>

          {otherMemberCount > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <p className="font-medium">
                В проекте ещё {otherMemberCount}{' '}
                {otherMemberCount === 1 ? 'другой участник' : 'других участников'} — они
                потеряют доступ.
              </p>
              <p className="mt-1">
                Если хотите передать проект — закройте этот диалог, откройте раздел{' '}
                «Команда» и нажмите «Передать владение» рядом с нужным человеком.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={deleting}
          >
            {deleting && <Loader2 className="size-4 animate-spin" />}
            Удалить навсегда
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
