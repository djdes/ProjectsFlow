import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import type { Project, ProjectStatus } from '@/domain/project/Project';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Активен',
  paused: 'На паузе',
  archived: 'Архив',
};

const STATUS_DOT: Record<ProjectStatus, string> = {
  active: 'bg-emerald-500',
  paused: 'bg-amber-500',
  archived: 'bg-muted-foreground/50',
};

// Статус проекта как рабочий переключатель (вместо мёртвого бейджа).
// Viewer видит статичный бейдж без dropdown.
export function ProjectStatusSelect({ project }: { project: Project }): React.ReactElement {
  const { submit, saving } = useUpdateProject();
  const canEdit = project.role === 'owner' || project.role === 'editor';

  const handleChange = async (value: string): Promise<void> => {
    try {
      await submit(project.id, { status: value as ProjectStatus });
    } catch {
      toast.error('Не удалось сменить статус');
    }
  };

  const badge = (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className={`size-1.5 rounded-full ${STATUS_DOT[project.status]}`} />
      {STATUS_LABEL[project.status]}
      {canEdit && <ChevronDown className="size-3" />}
    </span>
  );

  if (!canEdit) return badge;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={saving} className="rounded-md disabled:opacity-60">
        {badge}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={project.status} onValueChange={(v) => void handleChange(v)}>
          {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              <span className={`mr-2 size-1.5 rounded-full ${STATUS_DOT[s]}`} />
              {STATUS_LABEL[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
