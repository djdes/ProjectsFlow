import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import type { Task } from '@/domain/task/Task';
import { TaskCommitsSection } from './TaskCommitsSection';

export type TaskDialogState =
  | { mode: 'create'; status: Task['status'] }
  | { mode: 'edit'; task: Task };

type Props = {
  state: TaskDialogState | null;
  onClose: () => void;
  onSubmit: (input: { title: string; description: string | null }) => Promise<void>;
  // Колбэк когда коммиты у задачи поменялись — board перефетчит badge'и.
  onCommitsChange?: () => void;
};

export function TaskDialog({
  state,
  onClose,
  onSubmit,
  onCommitsChange,
}: Props): React.ReactElement {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    if (state.mode === 'edit') {
      setTitle(state.task.title);
      setDescription(state.task.description ?? '');
    } else {
      setTitle('');
      setDescription('');
    }
    setError(null);
  }, [state]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (title.trim().length === 0) {
      setError('Введите название');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), description: description.trim() || null });
      onClose();
    } catch (err) {
      setError((err as Error).message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      {/* max-h + grid с прижатыми header/footer и скроллом в body — чтоб длинные секции
          (особенно коммиты + пикер) не выезжали за viewport. */}
      <DialogContent className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>
            {state?.mode === 'edit' ? 'Редактировать задачу' : 'Новая задача'}
          </DialogTitle>
          <DialogDescription>
            Минимум — название. Описание опционально.
          </DialogDescription>
        </DialogHeader>

        <form
          id="task-dialog-form"
          onSubmit={handleSubmit}
          className="space-y-4 overflow-y-auto px-6 pb-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Название</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
              placeholder="Что нужно сделать"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Описание</Label>
            <textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={4}
              placeholder="Контекст, шаги, ссылки"
              className="w-full rounded-md border bg-background p-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}

          {state?.mode === 'edit' && (
            <div className="border-t pt-4">
              <TaskCommitsSection
                task={state.task}
                onChange={() => onCommitsChange?.()}
              />
            </div>
          )}
        </form>

        <DialogFooter className="border-t bg-background px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="task-dialog-form" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {state?.mode === 'edit' ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
