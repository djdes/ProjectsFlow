import { LayoutTemplate } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import type { Task } from '@/domain/task/Task';

type Props = {
  task: Task;
  // Текущий текст из редактора (может опережать сохранённый task.description).
  description: string;
  disabled?: boolean;
};

// «Сохранить как шаблон» в меню «⋯» окна задачи: текст с чеклистом (отметки сервер снимет),
// приоритет, тип и повтор — в шаблоны пространства задачи. Взять шаблон можно в окне
// «Новая задача» → «Шаблон».
export function SaveAsTemplateMenuItem({ task, description, disabled }: Props): React.ReactElement {
  const { workspaceTaskTemplateRepository } = useContainer();
  const { data: workspaces } = useWorkspaces();
  const workspaceId =
    task.context?.workspaceId ?? (workspaces ?? []).find((w) => w.isCurrent)?.id ?? null;
  const text = description.trim();

  const save = async (): Promise<void> => {
    if (!workspaceId || !text) return;
    try {
      const template = await workspaceTaskTemplateRepository.create(workspaceId, {
        description: text,
        priority: task.priority,
        taskType: task.taskType,
        recurrence: task.recurrence ?? null,
      });
      toast.success(`Шаблон «${template.name}» сохранён`, {
        description: 'Выберите его в окне «Новая задача» → «Шаблон».',
      });
    } catch (e) {
      toast.error(`Не удалось сохранить шаблон: ${(e as Error).message}`);
    }
  };

  return (
    <DropdownMenuItem disabled={disabled || !workspaceId || !text} onSelect={() => void save()}>
      <LayoutTemplate className="text-muted-foreground" /> Сохранить как шаблон
    </DropdownMenuItem>
  );
}
