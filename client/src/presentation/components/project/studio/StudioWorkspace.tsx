import type { Project } from '@/domain/project/Project';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { ProjectDashboard } from '@/presentation/components/project/workspace/ProjectDashboard';
import { ProjectPreview } from '@/presentation/components/project/workspace/ProjectPreview';
import type { DashboardSection } from '@/presentation/components/project/workspace/dashboard/dashboardConfig';
import type { StudioPanel } from './StudioTopBar';
import type { StudioSaveState } from './SaveStatusIndicator';

export function StudioWorkspace({
  panel,
  project,
  members,
  canEdit,
  path,
  section,
  onPathChange,
  onSectionChange,
  onOpenPreview,
  onOpenAutomation,
  previewToolbarLeading,
  previewToolbarTrailing,
  onSaveStateChange,
}: {
  panel: StudioPanel;
  project: Project;
  members: readonly ProjectMember[];
  canEdit: boolean;
  path: string;
  section: DashboardSection;
  onPathChange: (path: string) => void;
  onSectionChange: (section: DashboardSection) => void;
  onOpenPreview: () => void;
  onOpenAutomation: () => void;
  previewToolbarLeading?: React.ReactNode;
  previewToolbarTrailing?: React.ReactNode;
  onSaveStateChange?: (state: StudioSaveState) => void;
}): React.ReactElement {
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-background">
      {panel === 'preview' ? (
        <ProjectPreview
          key={`studio-preview-${project.id}`}
          projectId={project.id}
          initialPath={path}
          onPathChange={onPathChange}
          fillAvailable
          toolbarLeading={previewToolbarLeading}
          toolbarTrailing={previewToolbarTrailing}
          studioLayout
          onSaveStateChange={onSaveStateChange}
        />
      ) : (
        <ProjectDashboard
          key={`studio-dashboard-${project.id}`}
          project={project}
          members={members}
          canEdit={canEdit}
          initialSection={section}
          onSectionChange={onSectionChange}
          onOpenPreview={onOpenPreview}
          onOpenAutomation={onOpenAutomation}
          fillAvailable
        />
      )}
    </div>
  );
}
