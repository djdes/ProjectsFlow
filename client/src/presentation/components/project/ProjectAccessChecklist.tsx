import { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { WorkspaceAccessProject } from '@/domain/workspace/WorkspaceProjectAccess';

export function ProjectAccessChecklist({ projects, hiddenIds, onChange, disabled = false }: {
  projects: readonly WorkspaceAccessProject[];
  hiddenIds: readonly string[];
  onChange: (projectId: string, visible: boolean) => void;
  disabled?: boolean;
}): React.ReactElement {
  const [search, setSearch] = useState('');
  const selected = projects.filter((p) => !hiddenIds.includes(p.id)).length;
  return (
    <details className="group rounded-md border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">Доступ к проектам</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{selected} из {projects.length}</span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t p-2">
        {projects.length > 6 && (
          <div className="flex items-center gap-2 px-1">
            <Search className="size-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Найти проект" placeholder="Найти проект" className="h-8" />
          </div>
        )}
        <div className="max-h-56 overflow-y-auto overscroll-contain">
          {projects.filter((p) => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((p) => (
            <label key={p.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
              <Checkbox className="size-4" checked={!hiddenIds.includes(p.id)} disabled={disabled} onCheckedChange={(checked) => onChange(p.id, checked === true)} aria-label={`Доступ к проекту «${p.name}»`} />
              {p.icon && <span aria-hidden="true">{p.icon}</span>}
              <span className="min-w-0 break-words">{p.name}</span>
            </label>
          ))}
          {projects.length === 0 && <p className="p-2 text-xs text-muted-foreground">В пространстве пока нет проектов.</p>}
          {projects.length > 0 && !projects.some((p) => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className="p-2 text-xs text-muted-foreground">Проекты не найдены.</p>}
        </div>
        <p className="px-2 pb-1 text-xs text-muted-foreground">Новые проекты доступны автоматически. Личные входящие видны только их владельцу.</p>
      </div>
    </details>
  );
}
