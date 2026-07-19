import { useMemo, useState } from 'react';
import { Check, Circle, ExternalLink, Loader2, ListChecks, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import type { Task, TaskPriority, TaskStatus } from '@/domain/task/Task';

const ACTION_BLOCK = /```projectsflow-actions\s*([\s\S]*?)```/iu;
const STATUSES = new Set<TaskStatus>(['backlog', 'todo', 'in_progress', 'awaiting_clarification', 'done', 'manual']);

type ProjectTarget = { projectId?: string; projectRef?: string };
type CreateProjectAction = { id: string; type: 'create_project'; name: string };
type CreateTaskAction = ProjectTarget & { id: string; type: 'create_task'; description: string; status?: TaskStatus; deadline?: string | null; priority?: TaskPriority | null; assigneeUserId?: string };
type UpdateTaskAction = ProjectTarget & { id: string; type: 'update_task'; taskId: string; description?: string; status?: TaskStatus; deadline?: string | null; priority?: TaskPriority | null };
type DeleteTaskAction = ProjectTarget & { id: string; type: 'delete_task'; taskId: string };
type DeleteAllTasksAction = ProjectTarget & { id: string; type: 'delete_all_tasks' };
export type AiAction = CreateProjectAction | CreateTaskAction | UpdateTaskAction | DeleteTaskAction | DeleteAllTasksAction;
export type AiActionPlan = { title: string; summary?: string; actions: AiAction[] };

type ItemState = { status: 'pending' | 'running' | 'done' | 'failed' | 'undone'; error?: string; href?: string };
type UndoEntry = { projectId: string; undo: () => Promise<void> };

export function extractAiActionPlan(body: string): { text: string; plan: AiActionPlan | null } {
  const match = ACTION_BLOCK.exec(body);
  if (!match) return { text: body, plan: null };
  try {
    const candidate = JSON.parse(match[1] ?? '') as unknown;
    const plan = normalizePlan(candidate);
    if (!plan) return { text: body, plan: null };
    return { text: body.replace(match[0], '').trim(), plan };
  } catch {
    return { text: body, plan: null };
  }
}

function normalizePlan(value: unknown): AiActionPlan | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { title?: unknown; summary?: unknown; actions?: unknown };
  if (!Array.isArray(raw.actions) || raw.actions.length === 0 || raw.actions.length > 200) return null;
  const actions = raw.actions.map(normalizeAction).filter((item): item is AiAction => item !== null);
  if (actions.length !== raw.actions.length) return null;
  if (new Set(actions.map((action) => action.id)).size !== actions.length) return null;
  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 180) : 'Предложенные действия',
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 600) : undefined,
    actions,
  };
}

function normalizeAction(value: unknown): AiAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim().slice(0, 80) : '';
  if (!id) return null;
  const project = {
    projectId: typeof raw['projectId'] === 'string' ? raw['projectId'] : undefined,
    projectRef: typeof raw['projectRef'] === 'string' ? raw['projectRef'] : undefined,
  };
  if (raw['type'] === 'create_project' && typeof raw['name'] === 'string' && raw['name'].trim()) return { id, type: 'create_project', name: raw['name'].trim().slice(0, 200) };
  if (raw['type'] === 'create_task' && typeof raw['description'] === 'string' && raw['description'].trim()) return {
    ...project, id, type: 'create_task', description: raw['description'].trim().slice(0, 20_000),
    status: isStatus(raw['status']) ? raw['status'] : undefined,
    deadline: typeof raw['deadline'] === 'string' || raw['deadline'] === null ? raw['deadline'] : undefined,
    priority: isPriority(raw['priority']) || raw['priority'] === null ? raw['priority'] : undefined,
    assigneeUserId: typeof raw['assigneeUserId'] === 'string' ? raw['assigneeUserId'] : undefined,
  };
  if (raw['type'] === 'update_task' && typeof raw['taskId'] === 'string') return {
    ...project, id, type: 'update_task', taskId: raw['taskId'],
    description: typeof raw['description'] === 'string' ? raw['description'].slice(0, 20_000) : undefined,
    status: isStatus(raw['status']) ? raw['status'] : undefined,
    deadline: typeof raw['deadline'] === 'string' || raw['deadline'] === null ? raw['deadline'] : undefined,
    priority: isPriority(raw['priority']) || raw['priority'] === null ? raw['priority'] : undefined,
  };
  if (raw['type'] === 'delete_task' && typeof raw['taskId'] === 'string') return { ...project, id, type: 'delete_task', taskId: raw['taskId'] };
  if (raw['type'] === 'delete_all_tasks') return { ...project, id, type: 'delete_all_tasks' };
  return null;
}

function isStatus(value: unknown): value is TaskStatus { return typeof value === 'string' && STATUSES.has(value as TaskStatus); }
function isPriority(value: unknown): value is TaskPriority { return value === 1 || value === 2 || value === 3 || value === 4; }

export function AiActionPlanCard({ plan, defaultProjectId }: { plan: AiActionPlan; defaultProjectId?: string }): React.ReactElement {
  const { projectRepository, taskRepository } = useContainer();
  const { user } = useCurrentUser();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [items, setItems] = useState<Record<string, ItemState>>(() => Object.fromEntries(plan.actions.map((action) => [action.id, { status: 'pending' }])));
  const [undoEntries, setUndoEntries] = useState<UndoEntry[]>([]);
  const doneCount = useMemo(() => Object.values(items).filter((item) => item.status === 'done').length, [items]);

  const updateItem = (id: string, patch: Partial<ItemState>): void => setItems((current) => ({ ...current, [id]: { ...(current[id] ?? { status: 'pending' }), ...patch } }));
  const resolveProject = (action: ProjectTarget, refs: Map<string, string>): string => {
    const value = action.projectId ?? (action.projectRef ? refs.get(action.projectRef) : undefined) ?? defaultProjectId;
    if (!value) throw new Error('Не указан проект для действия');
    return value;
  };

  const run = async (): Promise<void> => {
    if (!user || running || completed) return;
    setConfirmOpen(false);
    setRunning(true);
    const refs = new Map<string, string>();
    const journal: UndoEntry[] = [];
    for (const action of plan.actions) {
      updateItem(action.id, { status: 'running', error: undefined });
      try {
        if (action.type === 'create_project') {
          const project = await projectRepository.create({ name: action.name });
          refs.set(action.id, project.id);
          journal.push({ projectId: project.id, undo: () => projectRepository.delete(project.id) });
          updateItem(action.id, { status: 'done', href: `/projects/${project.id}` });
          announceProjectChange(project.id);
        } else if (action.type === 'create_task') {
          const projectId = resolveProject(action, refs);
          const task = await taskRepository.create(projectId, {
            description: action.description,
            status: action.status ?? 'todo',
            deadline: action.deadline,
            priority: action.priority,
            assigneeUserId: action.assigneeUserId ?? user.id,
          });
          journal.push({ projectId, undo: () => taskRepository.delete(projectId, task.id) });
          updateItem(action.id, { status: 'done', href: `/projects/${projectId}?task=${task.id}` });
          announceProjectChange(projectId, task.id);
        } else {
          const projectId = resolveProject(action, refs);
          const tasks = await taskRepository.list(projectId);
          if (action.type === 'delete_all_tasks') {
            const deleted: Task[] = [];
            journal.push({ projectId, undo: async () => {
              for (const task of deleted) await restoreTask(taskRepository, task);
            } });
            for (const task of tasks) {
              await taskRepository.delete(projectId, task.id);
              deleted.push(task);
            }
            updateItem(action.id, { status: 'done', href: `/projects/${projectId}` });
            announceProjectChange(projectId);
            continue;
          }
          const before = tasks.find((task) => task.id === action.taskId);
          if (!before) throw new Error('Задача не найдена или уже удалена');
          if (action.type === 'delete_task') {
            await taskRepository.delete(projectId, action.taskId);
            journal.push({ projectId, undo: async () => { await restoreTask(taskRepository, before); } });
            updateItem(action.id, { status: 'done' });
            announceProjectChange(projectId);
          } else {
            const patch = { description: action.description, deadline: action.deadline, priority: action.priority };
            await taskRepository.update(projectId, action.taskId, patch);
            if (action.status && action.status !== before.status) await taskRepository.move(projectId, action.taskId, { targetStatus: action.status, beforeTaskId: null, afterTaskId: null });
            journal.push({ projectId, undo: async () => {
              await taskRepository.update(projectId, before.id, { description: before.description ?? '', deadline: before.deadline, priority: before.priority });
              if (action.status && before.status !== action.status) await taskRepository.move(projectId, before.id, { targetStatus: before.status, beforeTaskId: null, afterTaskId: null });
            } });
            updateItem(action.id, { status: 'done', href: `/projects/${projectId}?task=${action.taskId}` });
            announceProjectChange(projectId);
          }
        }
      } catch (error) {
        updateItem(action.id, { status: 'failed', error: error instanceof Error ? error.message : 'Неизвестная ошибка' });
      }
    }
    setUndoEntries(journal);
    setCompleted(true);
    setRunning(false);
    toast.success(`Выполнено действий: ${journal.length} из ${plan.actions.length}`);
  };

  const undo = async (): Promise<void> => {
    if (undoing || undoEntries.length === 0) return;
    setUndoing(true);
    let undone = 0;
    for (const entry of [...undoEntries].reverse()) {
      try {
        await entry.undo();
        announceProjectChange(entry.projectId);
        undone += 1;
      } catch { /* keep undoing the remaining independent operations */ }
    }
    setItems((current) => Object.fromEntries(Object.entries(current).map(([id, item]) => [id, item.status === 'done' ? { ...item, status: 'undone' } : item])));
    setUndoEntries([]);
    setUndoing(false);
    toast.success(`Отменено действий: ${undone}`);
  };

  return (
    <section className="not-prose mt-3 overflow-hidden rounded-xl border bg-card" aria-label={plan.title}>
      <div className="border-b bg-muted/25 px-3 py-2.5"><div className="flex items-start gap-2"><ListChecks className="mt-0.5 size-4 text-primary" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{plan.title}</h3>{plan.summary && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{plan.summary}</p>}</div><span className="text-xs tabular-nums text-muted-foreground">{doneCount}/{plan.actions.length}</span></div></div>
      <div className="max-h-72 overflow-y-auto p-1.5">
        {plan.actions.map((action, index) => {
          const item = items[action.id] ?? { status: 'pending' as const };
          return <div key={action.id} className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/45">{statusIcon(item.status)}<div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{actionLabel(action)}</p>{item.error && <p className="truncate text-[10px] text-destructive">{item.error}</p>}</div><span className="text-[10px] text-muted-foreground">{index + 1}</span>{item.href && <a href={item.href} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" aria-label="Открыть результат"><ExternalLink className="size-3.5" /></a>}</div>;
        })}
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
        {completed && undoEntries.length > 0 && <Button type="button" variant="outline" size="sm" disabled={undoing} onClick={() => void undo()}>{undoing ? <Loader2 className="animate-spin" /> : <RotateCcw />}Восстановить</Button>}
        {!completed && <Button type="button" size="sm" disabled={running || !user} onClick={() => setConfirmOpen(true)}>{running ? <Loader2 className="animate-spin" /> : <Check />}Подтвердить {plan.actions.length}</Button>}
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent className="sm:max-w-md"><DialogTitle>Выполнить предложенные действия?</DialogTitle><DialogDescription>ProjectsFlow последовательно применит {plan.actions.length} действий. До подтверждения ИИ ничего не меняет. После выполнения изменения можно отменить.</DialogDescription><DialogFooter><Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>Отмена</Button><Button type="button" onClick={() => void run()}>Выполнить</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}

function statusIcon(status: ItemState['status']): React.ReactElement {
  if (status === 'running') return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />;
  if (status === 'done') return <Check className="size-3.5 shrink-0 text-emerald-600" />;
  if (status === 'failed') return <Trash2 className="size-3.5 shrink-0 text-destructive" />;
  if (status === 'undone') return <RotateCcw className="size-3.5 shrink-0 text-muted-foreground" />;
  return <Circle className="size-3.5 shrink-0 text-muted-foreground" />;
}

function actionLabel(action: AiAction): string {
  if (action.type === 'delete_all_tasks') return 'Удалить все задачи проекта';
  if (action.type === 'create_project') return `Создать проект «${action.name}»`;
  if (action.type === 'create_task') return `Создать задачу: ${action.description.split('\n')[0]}`;
  if (action.type === 'update_task') return `Изменить задачу ${action.taskId.slice(0, 8)}`;
  return `Удалить задачу ${action.taskId.slice(0, 8)}`;
}

async function restoreTask(repository: ReturnType<typeof useContainer>['taskRepository'], task: Task): Promise<void> {
  await repository.create(task.projectId, {
    description: task.description ?? '', icon: task.icon, cover: task.cover, coverPosition: task.coverPosition,
    status: task.status, ralphMode: task.ralphMode, assigneeUserId: task.assignee.userId,
    deadline: task.deadline, startDate: task.startDate, parentTaskId: task.parentTaskId, priority: task.priority,
  });
}

function announceProjectChange(projectId: string, createdTaskId?: string): void {
  const detail = { projectId };
  window.dispatchEvent(new CustomEvent('pf:project-changed', { detail }));
  window.dispatchEvent(new CustomEvent('pf:task-changed', { detail }));
  window.dispatchEvent(new CustomEvent('pf:project-activity-changed', { detail }));
  if (createdTaskId) {
    window.dispatchEvent(new CustomEvent('pf:task-created', { detail: { projectId, taskId: createdTaskId } }));
  }
}
