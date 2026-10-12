import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import type { Task, TaskStatus } from '@/domain/task/Task';
import type { Project } from '@/domain/project/Project';
import type { KanbanBoardSettings } from '@/domain/kanban/KanbanSettings';
import { taskStatusOptions } from '@/domain/task/taskEditorOptions';
import { useContainer } from '@/infrastructure/di/container';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { PROPERTY_CARET_CLASS, PROPERTY_VALUE_CLASS } from './PropertyRow';
import { resolveStatusLabel } from './statusLabels';

export function TaskStatusField({ task, disabled, beforeChange, onMove, onChanged }: {
  task: Task;
  disabled: boolean;
  beforeChange: () => Promise<void>;
  onMove?: (id: string, status: TaskStatus) => Promise<Task | void>;
  onChanged: (task: Task) => void;
}): React.ReactElement {
  const { taskRepository, projectRepository } = useContainer();
  const { data: workspaces } = useWorkspaces();
  const [settings, setSettings] = useState<KanbanBoardSettings | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setProject(null);
    void Promise.all([projectRepository.getKanbanSettings(task.projectId), projectRepository.getById(task.projectId)])
      .then(([board, current]) => { if (!cancelled) { setSettings(board); setProject(current); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectRepository, task.projectId]);
  const workspace = workspaces?.find((w) => project?.workspaceId ? w.id === project.workspaceId : w.isCurrent);
  const options = taskStatusOptions(settings, workspace?.workerEnabled ?? false, workspace?.requireTaskApproval ?? false, task.status);
  const change = async (next: TaskStatus): Promise<void> => {
    if (disabled || busy.current || next === task.status) return;
    busy.current = true;
    setSaving(true);
    try {
      await beforeChange();
      let updated = onMove
        ? await onMove(task.id, next)
        : await taskRepository.move(task.projectId, task.id, { targetStatus: next, beforeTaskId: null, afterTaskId: null });
      // Older board callbacks return void. Read the actual result, including approval.
      if (!updated) updated = (await taskRepository.list(task.projectId)).find((item) => item.id === task.id);
      if (!updated) throw new Error('Откройте задачу заново, чтобы обновить её статус');
      onChanged(updated);
      toast.success(`Статус: ${resolveStatusLabel(settings, updated.status)}`);
    } catch (error) {
      toast.error(`Не удалось сменить статус: ${(error as Error).message}`);
    } finally { busy.current = false; setSaving(false); }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={PROPERTY_VALUE_CLASS} disabled={disabled || saving} aria-label="Сменить статус">
          <span className="min-w-0 truncate">{resolveStatusLabel(settings, task.status)}</span>
          {!disabled && (saving ? <Loader2 className="ms-auto size-3 motion-safe:animate-spin" /> : <ChevronDown className={PROPERTY_CARET_CLASS} />)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label="Статус задачи" className="min-w-60">
        <DropdownMenuLabel>Статус задачи</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={task.status} onValueChange={(value) => void change(value as TaskStatus)}>
          {options.map((status) => <DropdownMenuRadioItem key={status} value={status}>{resolveStatusLabel(settings, status)}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
