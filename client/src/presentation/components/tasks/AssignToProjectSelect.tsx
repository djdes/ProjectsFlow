import { useEffect, useState } from 'react';
import { ChevronDown, FolderInput } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import type { Task } from '@/domain/task/Task';

type Props = {
  task: Task;
  // Колбэк после успешного assignToProject — родителю refetch + закрытие drawer'а.
  onAssigned: () => void;
};

// Селект «Перенести в проект» в шапке TaskDrawer (edit-mode, только для inbox-задач).
// Список — все НЕ-inbox проекты caller'а. При выборе — confirm + POST.
// Активная делегация (если была) автоматически архивируется на сервере, делегат
// получает email + notification.
export function AssignToProjectSelect({ task, onAssigned }: Props): React.ReactElement {
  const { projectRepository, taskRepository } = useContainer();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectRepository
      .list()
      .then((list) => {
        if (!cancelled) setProjects(list.filter((p) => !p.isInbox));
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository]);

  const handle = async (projectId: string): Promise<void> => {
    if (submitting) return;
    if (!window.confirm('Перенести задачу в выбранный проект? Она исчезнет из «Входящих».')) {
      return;
    }
    setSubmitting(true);
    try {
      await taskRepository.assignToProject(task.projectId, task.id, projectId);
      toast.success('Задача перенесена');
      onAssigned();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          className="h-7 gap-1.5 px-2 text-xs"
          title="Перенести задачу в реальный проект"
        >
          <FolderInput className="size-3.5" />
          Перенести в проект
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        {(projects ?? []).map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => void handle(p.id)}>
            {p.name}
          </DropdownMenuItem>
        ))}
        {projects && projects.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Нет проектов</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
