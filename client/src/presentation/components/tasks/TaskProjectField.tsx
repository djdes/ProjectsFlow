import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderKanban, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import type { Project } from '@/domain/project/Project';
import type { Task } from '@/domain/task/Task';
import { taskProjectOptions } from '@/domain/task/taskEditorOptions';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { PROPERTY_CARET_CLASS, PROPERTY_VALUE_CLASS } from './PropertyRow';

export function TaskProjectField({ task, projectName, isInbox, disabled, beforeChange, onMoved }: {
  task: Task;
  projectName?: string;
  isInbox: boolean;
  disabled: boolean;
  beforeChange: () => Promise<void>;
  onMoved: (task: Task) => void;
}): React.ReactElement {
  const { projectRepository, taskRepository } = useContainer();
  const { user } = useCurrentUser();
  const [source, setSource] = useState<Task | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    if (task.canTransferProject !== undefined) return;
    void taskRepository.get(task.projectId, task.id).then((value) => { if (!cancelled) setSource(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [taskRepository, task.projectId, task.id, task.canTransferProject]);
  const currentSource = source?.id === task.id && source.projectId === task.projectId ? source : null;
  const canMove = !disabled && !!user && (task.canTransferProject ?? currentSource?.canTransferProject ?? false);
  const load = async (): Promise<void> => {
    setError(false);
    setProjects(null);
    try {
      const [list, inbox] = await Promise.all([projectRepository.list(), projectRepository.getInbox()]);
      const unique = [...new Map([...list, inbox].map((p) => [p.id, p])).values()];
      setProjects(taskProjectOptions(unique, user!.id));
    } catch { setError(true); }
  };
  const change = async (target: Project): Promise<void> => {
    if (!canMove || busy.current) return;
    if (task.projectId === target.id) { setOpen(false); return; }
    busy.current = true;
    setSaving(true);
    try {
      await beforeChange();
      const moved = await taskRepository.assignToProject(task.projectId, task.id, target.id);
      setOpen(false);
      toast.success(`Задача перенесена: ${target.isInbox ? 'Личные задачи' : target.name}`);
      onMoved(moved);
    } catch (e) { toast.error(`Не удалось перенести задачу: ${(e as Error).message}`); }
    finally { busy.current = false; setSaving(false); }
  };
  const context = task.context ?? currentSource?.context;
  const name = isInbox || context?.isInbox ? 'Личные задачи' : context?.projectName ?? projectName ?? 'Проект';
  const filtered = projects?.filter((p) => (p.isInbox ? 'Личные задачи' : p.name).toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru').trim()));
  return (
    <Popover open={open} onOpenChange={(next) => { if (saving) return; setOpen(next); if (next) { setQuery(''); void load(); } }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className={PROPERTY_VALUE_CLASS} disabled={!canMove || saving} aria-label="Сменить проект">
          <span className="min-w-0 truncate">{name}</span>
          {canMove && <ChevronDown className={PROPERTY_CARET_CLASS} />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Выбор проекта" className="w-80 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <h3 className="px-2 py-2 text-sm font-semibold">Перенести в проект</h3>
        <div className="relative mbe-2">
          <Search className="pointer-events-none absolute start-3 inset-bs-3 size-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти проект" aria-label="Найти проект" className="h-10 ps-9" disabled={saving} />
        </div>
        {error ? <Button variant="ghost" onClick={() => void load()}>Не удалось загрузить. Повторить</Button>
          : !projects ? <p className="p-3 text-sm text-muted-foreground">Загрузка…</p>
          : filtered?.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Проекты не найдены</p>
          : <div role="listbox" aria-label="Проекты" className="max-h-72 overflow-y-auto overscroll-contain" onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
              if (!options.length) return;
              event.preventDefault();
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
              options[next].focus();
            }}>
              {filtered?.map((project) => <button
                type="button" key={project.id} role="option" aria-selected={project.id === task.projectId}
                disabled={saving} onClick={() => void change(project)}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-start text-sm transition-colors active:bg-active [@media(hover:hover)_and_(pointer:fine)]:hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-words">{project.isInbox ? 'Личные задачи' : project.name}</span>
                {project.id === task.projectId && <Check className="size-4 shrink-0 text-primary" />}
              </button>)}
            </div>}
        {saving && <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 motion-safe:animate-spin" />Переносим…</p>}
      </PopoverContent>
    </Popover>
  );
}
