import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

// Стильное подтверждение удаления задачи — вместо нативного window.confirm.
// Иконка-корзина в красном «ореоле», превью задачи, явная необратимость.
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  taskLabel,
  onConfirm,
  busy = false,
  title = 'Удалить задачу?',
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Превью названия задачи (1-я строка). null — без конкретики («эту задачу»).
  taskLabel: string | null;
  onConfirm: () => void;
  busy?: boolean;
  // Кастомные заголовок/описание — для не-одиночных удалений (напр. массовое). По
  // умолчанию — прежнее поведение (одна задача).
  title?: string;
  description?: React.ReactNode;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-sm">

        <div className="flex flex-col items-center gap-3 px-6 pb-3 pt-7 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive ring-8 ring-destructive/[0.06]">
            <Trash2 className="size-5" />
          </span>
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-snug text-muted-foreground">
            {description ?? (
              taskLabel ? (
                <>
                  «<span className="font-medium text-foreground">{taskLabel}</span>» будет удалена
                  безвозвратно.
                </>
              ) : (
                'Задача будет удалена безвозвратно.'
              )
            )}
          </DialogDescription>
        </div>
        <div className="flex gap-2 border-t bg-muted/30 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="flex-1 gap-1.5"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Удалить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
