import { useState } from 'react';
import { ChevronDown, FolderOpen, Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ProjectIconView } from './projectIconView';
import type { WorkspaceAccessProject } from '@/domain/workspace/WorkspaceProjectAccess';

export function ProjectAccessChecklist({ projects, hiddenIds, onChange, disabled = false, label = 'Доступные проекты', defaultOpen = false, highlightProjectId }: {
  projects: readonly WorkspaceAccessProject[];
  hiddenIds: readonly string[];
  onChange: (projectId: string, visible: boolean) => void;
  disabled?: boolean;
  label?: string;
  defaultOpen?: boolean;
  highlightProjectId?: string;
}): React.ReactElement {
  const [search, setSearch] = useState('');
  const selected = projects.filter(p => !hiddenIds.includes(p.id));
  const visible = projects.filter(p => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const preview = selected.length === projects.length ? 'Все проекты пространства' : selected.length ? selected.map(p => p.name).join(', ') : 'Проекты не выбраны';
  return <details open={defaultOpen || undefined} className="group rounded-lg bg-muted/60 ring-1 ring-inset ring-border/60">
    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2.5 rounded-lg px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <FolderOpen className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
      <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-foreground [overflow-wrap:anywhere]">{label}</span><span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate" title={preview}>{preview}</span><span className="shrink-0 rounded bg-background px-1.5 py-0.5 tabular-nums">{selected.length}/{projects.length}</span></span></span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className="space-y-2 border-t border-border/60 p-2">
      {projects.length > 6 && <div className="flex items-center gap-2 px-1"><Search className="size-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} aria-label={`Найти проект: ${label}`} placeholder="Найти проект" className="h-8" /></div>}
      <div className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">
        {visible.map(p => <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md bg-background/75 px-2.5 py-2 text-sm hover:bg-background has-[:disabled]:cursor-default">
          <Checkbox className="size-4 shrink-0" checked={!hiddenIds.includes(p.id)} disabled={disabled} onCheckedChange={checked => onChange(p.id, checked === true)} aria-label={`${label}: ${p.name}`} />
          {p.icon && <span className="size-5 shrink-0"><ProjectIconView icon={p.icon} className="text-base" /></span>}
          <span className="min-w-0 flex-1 break-words">{p.name}</span>
          {p.id === highlightProjectId && <span className="shrink-0 text-[11px] text-primary">Этот проект</span>}
        </label>)}
        {!visible.length && <p className="p-2 text-xs text-muted-foreground">{projects.length ? 'Проекты не найдены.' : 'В пространстве пока нет проектов.'}</p>}
      </div>
      <p className="px-1 pb-1 text-xs leading-relaxed text-muted-foreground">Отмеченные проекты и их задачи видны участнику. Новые проекты будут доступны автоматически.</p>
    </div>
  </details>;
}
