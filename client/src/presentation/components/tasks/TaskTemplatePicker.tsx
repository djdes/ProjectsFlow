import { useState } from 'react';
import { LayoutTemplate, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import {
  canDeleteTaskTemplate,
  taskTemplateSummary,
  type WorkspaceTaskTemplate,
} from '@/domain/task/WorkspaceTaskTemplate';

type Props = {
  onApply: (template: WorkspaceTaskTemplate) => void;
  disabled?: boolean;
  className?: string;
};

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly templates: readonly WorkspaceTaskTemplate[] };

// «Шаблон» в окне «Новая задача»: шаблоны текущего пространства. Выбор заполняет текст,
// приоритет, тип и повтор; ненужный шаблон удаляется прямо из списка (автором, руководителем
// или владельцем). На телефоне Popover открывается нижним листом.
export function TaskTemplatePicker({ onApply, disabled, className }: Props): React.ReactElement {
  const { workspaceTaskTemplateRepository } = useContainer();
  const { user } = useCurrentUser();
  const { data: workspaces } = useWorkspaces();
  const workspace = (workspaces ?? []).find((w) => w.isCurrent) ?? null;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = (): void => {
    if (!workspace) return;
    setState({ kind: 'loading' });
    workspaceTaskTemplateRepository
      .list(workspace.id)
      .then((templates) => setState({ kind: 'ready', templates }))
      .catch(() => setState({ kind: 'error' }));
  };

  const remove = async (template: WorkspaceTaskTemplate): Promise<void> => {
    if (!workspace) return;
    setDeleting(template.id);
    try {
      await workspaceTaskTemplateRepository.remove(workspace.id, template.id);
      setState((prev) =>
        prev.kind === 'ready'
          ? { kind: 'ready', templates: prev.templates.filter((t) => t.id !== template.id) }
          : prev,
      );
      toast.success(`Шаблон «${template.name}» удалён`);
    } catch (e) {
      toast.error(`Не удалось удалить шаблон: ${(e as Error).message}`);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !workspace}
          className={cn('h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground', className)}
          title="Заполнить задачу по шаблону пространства"
        >
          <LayoutTemplate className="size-4" aria-hidden />
          Шаблон
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2" aria-label="Шаблоны задач">
        <h3 className="px-1 pbe-1.5 pbs-0.5 text-sm font-semibold">Шаблоны пространства</h3>
        {state.kind === 'loading' || state.kind === 'idle' ? (
          <p className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
            Загрузка…
          </p>
        ) : state.kind === 'error' ? (
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={load}>
            Не удалось загрузить. Повторить
          </Button>
        ) : state.templates.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            Шаблонов пока нет. Откройте задачу и выберите в меню «⋯» пункт «Сохранить как шаблон».
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5" aria-label="Шаблоны">
            {state.templates.map((template) => {
              const summary = taskTemplateSummary(template);
              return (
                <li key={template.id} className="group/template flex items-center gap-1 rounded-md hover:bg-hover">
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-md px-2 py-1 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-9"
                    onClick={() => {
                      onApply(template);
                      setOpen(false);
                    }}
                  >
                    <span className="w-full truncate text-sm">{template.name}</span>
                    {summary && <span className="w-full truncate text-meta text-muted-foreground">{summary}</span>}
                  </button>
                  {canDeleteTaskTemplate(template, user?.id, workspace?.role) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 text-muted-foreground hover:text-destructive sm:size-8"
                      disabled={deleting === template.id}
                      onClick={() => void remove(template)}
                      aria-label={`Удалить шаблон «${template.name}»`}
                      title="Удалить шаблон"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
