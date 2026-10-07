import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Project } from '@/domain/project/Project';
import { useProjectWorkspace } from '@/presentation/hooks/useProjectWorkspace';
import { OverviewSection } from './OverviewSection';
import { WorkspaceMembersPanel } from './WorkspaceMembersPanel';

export function TeamSection({ project }: { project: Project }): React.ReactElement | null {
  const workspace = useProjectWorkspace(project);
  if (project.isInbox) return null;
  return <OverviewSection title="Участники" actions={workspace && (
    <Button asChild size="sm" variant="outline"><Link to={`/workspaces/${workspace.id}/settings`}><Settings2 className="size-4" />Настройки пространства</Link></Button>
  )}>
    {workspace ? <WorkspaceMembersPanel key={workspace.id} workspace={workspace} projectId={project.id} /> : <p className="text-sm text-muted-foreground">Загружаем пространство…</p>}
  </OverviewSection>;
}
