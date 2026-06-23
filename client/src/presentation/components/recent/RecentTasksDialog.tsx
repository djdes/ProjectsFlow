import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRecentTasks } from '@/presentation/hooks/useRecentTasks';
import { RecentTaskRow } from './RecentTaskRow';

// «Вся история» недавно открытых задач — больше записей, чем 3 в сайдбаре. Клик
// по строке ведёт на доску проекта + открывает карточку (?task=) и закрывает диалог.
const HISTORY_LIMIT = 30;

export function RecentTasksDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            Недавнее
          </DialogTitle>
          <DialogDescription>Задачи, которые вы недавно открывали.</DialogDescription>
        </DialogHeader>
        {/* Тело монтируем только когда диалог открыт — не фетчим 30 записей зря. */}
        {open && <HistoryBody onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function HistoryBody({ onClose }: { onClose: () => void }): React.ReactElement {
  const navigate = useNavigate();
  const { items, loading } = useRecentTasks(HISTORY_LIMIT);

  if (loading && items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Загрузка…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Пока пусто — откройте любую задачу.
      </p>
    );
  }

  return (
    <ul className="-mx-2 max-h-[60dvh] divide-y divide-border/60 overflow-y-auto">
      {items.map((item) => (
        <li key={item.taskId}>
          <button
            type="button"
            onClick={() => {
              navigate(`/projects/${item.projectId}?task=${item.taskId}`);
              onClose();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-foreground/[0.05] dark:hover:bg-white/[0.06]"
          >
            <RecentTaskRow item={item} />
          </button>
        </li>
      ))}
    </ul>
  );
}
