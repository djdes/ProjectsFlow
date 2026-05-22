import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Inbox } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useProjects } from '@/presentation/hooks/useProjects';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Sentinel для пункта «Без проекта» в radio-группе (radix требует строковое value).
const INBOX_VALUE = '__inbox__';

export function AddTaskDialog({ open, onOpenChange }: Props): React.ReactElement {
  const navigate = useNavigate();
  const { taskRepository, projectRepository } = useContainer();
  const { data: projects } = useProjects();
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDescription('');
      setProjectId(null);
      setError(null);
    }
  }, [open]);

  // Только реальные проекты — inbox выбирается пунктом «Без проекта».
  const realProjects = (projects ?? []).filter((p) => !p.isInbox);
  const selectedName =
    projectId === null
      ? 'Без проекта (Входящие)'
      : (realProjects.find((p) => p.id === projectId)?.name ?? 'Без проекта (Входящие)');

  const trimmed = description.trim();
  const disabled = saving || trimmed.length === 0;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (disabled) return;
    setSaving(true);
    setError(null);
    try {
      // По умолчанию (без проекта) — во «Входящие»; иначе в выбранный проект.
      const targetId = projectId ?? (await projectRepository.getInbox()).id;
      await taskRepository.create(targetId, { description: trimmed, status: 'backlog' });
      onOpenChange(false);
      toast.success(
        projectId === null ? 'Задача добавлена во «Входящие»' : 'Задача добавлена в проект',
      );
      navigate(projectId === null ? '/inbox' : `/projects/${projectId}`);
    } catch (err) {
      setError(`Не удалось добавить задачу: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-desc">
              Описание <span className="text-destructive">*</span>
            </Label>
            <textarea
              id="task-desc"
              autoFocus
              rows={5}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что нужно сделать. Контекст, шаги, ссылки."
              className="block w-full resize-none rounded-md border bg-background p-2 text-sm leading-snug placeholder:text-muted-foreground/70 focus:border-foreground/30 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <Label>Проект</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between font-normal">
                  <span className="flex items-center gap-2 truncate">
                    {projectId === null && <Inbox className="size-4 shrink-0 text-muted-foreground" />}
                    {selectedName}
                  </span>
                  <ChevronDown className="size-4 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
                <DropdownMenuRadioGroup
                  value={projectId ?? INBOX_VALUE}
                  onValueChange={(v) => setProjectId(v === INBOX_VALUE ? null : v)}
                >
                  <DropdownMenuRadioItem value={INBOX_VALUE}>
                    Без проекта (Входящие)
                  </DropdownMenuRadioItem>
                  {realProjects.map((p) => (
                    <DropdownMenuRadioItem key={p.id} value={p.id}>
                      {p.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={disabled}>
              {saving ? 'Добавляем…' : 'Добавить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
