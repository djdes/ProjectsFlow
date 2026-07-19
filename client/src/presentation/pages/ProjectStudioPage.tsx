import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { AutomationDialog } from '@/presentation/components/project/AutomationDialog';
import { MemberAvatarStack } from '@/presentation/components/project/MemberAvatarStack';
import { ProjectActionsMenu } from '@/presentation/components/project/ProjectActionsMenu';
import { ProjectActivityButton } from '@/presentation/components/project/ProjectActivityButton';
import { ProjectSharePopover } from '@/presentation/components/project/ProjectSharePopover';
import {
  StudioChatPane,
  StudioMobileChatSheet,
  StudioTopBar,
  StudioWorkspace,
  type StudioPanel,
  useStudioSplitPane,
} from '@/presentation/components/project/studio';
import {
  resolveDashboardSection,
  type DashboardSection,
} from '@/presentation/components/project/workspace/dashboard/dashboardConfig';
import { normalizePreviewPath } from '@/presentation/components/project/workspace/preview/path';

type StudioData = {
  project: Project;
  members: ProjectMember[];
  conversationId: string;
};

function resolvePanel(value: string | null): StudioPanel {
  return value === 'dashboard' ? 'dashboard' : 'preview';
}

export function ProjectStudioPage({ projectId: projectIdProp }: { projectId?: string } = {}): React.ReactElement {
  const params = useParams<{ projectId?: string }>();
  const projectId = projectIdProp ?? params.projectId ?? '';
  const {
    getProject,
    projectRepository,
    aiConversationRepository,
    projectFinanceRepository,
    monitoringRepository,
  } = useContainer();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<StudioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [financeVisible, setFinanceVisible] = useState(false);
  const [monitoringVisible, setMonitoringVisible] = useState(false);
  const [monitoringAlerts, setMonitoringAlerts] = useState(0);
  const splitPane = useStudioSplitPane();

  // Studio starts as a focused workspace. This signal runs once for the mounted
  // page; after that the user may reopen the global sidebar and it will push the
  // workspace to the right without being closed again.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('pf:set-sidebar-collapsed', {
      detail: { collapsed: true },
    }));
  }, []);

  const panel = resolvePanel(searchParams.get('panel'));
  const path = normalizePreviewPath(searchParams.get('path') ?? '/') ?? '/';
  const section = resolveDashboardSection(searchParams.get('section'));

  const updateQuery = useCallback((updates: Record<string, string>, replace = false): void => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(updates).forEach(([key, value]) => next.set(key, value));
      return next;
    }, { replace });
  }, [setSearchParams]);

  useEffect(() => {
    const needsCanonicalQuery = !searchParams.has('panel') || !searchParams.has('path') || !searchParams.has('section');
    if (!needsCanonicalQuery) return;
    updateQuery({ panel, path, section }, true);
  }, [panel, path, searchParams, section, updateQuery]);

  useEffect(() => {
    if (!projectId) {
      setError('Проект не выбран.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getProject.execute(projectId),
      projectRepository.listMembers(projectId),
      aiConversationRepository.getOrCreateProjectStudio(projectId),
    ]).then(([project, members, conversation]) => {
      if (cancelled) return;
      if (!project) {
        setError('Проект не найден или у вас больше нет к нему доступа.');
        return;
      }
      setData({ project, members, conversationId: conversation.id });
      document.title = `${project.name} — Project Studio`;
    }).catch(() => {
      if (!cancelled) setError('Не удалось открыть Project Studio. Проверьте соединение и попробуйте ещё раз.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [aiConversationRepository, getProject, projectId, projectRepository, reload]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    projectFinanceRepository.getSummary(projectId)
      .then(() => { if (!cancelled) setFinanceVisible(true); })
      .catch(() => { if (!cancelled) setFinanceVisible(false); });
    monitoringRepository.listServers(projectId)
      .then(() => { if (!cancelled) setMonitoringVisible(true); })
      .catch(() => { if (!cancelled) setMonitoringVisible(false); });
    monitoringRepository.listAlerts(projectId, true)
      .then((alerts) => { if (!cancelled) setMonitoringAlerts(alerts.length); })
      .catch(() => { if (!cancelled) setMonitoringAlerts(0); });
    return () => { cancelled = true; };
  }, [monitoringRepository, projectFinanceRepository, projectId]);

  const canEdit = data?.project.role !== 'viewer';
  const panelChange = useCallback((next: StudioPanel): void => {
    updateQuery({ panel: next });
  }, [updateQuery]);
  const pathChange = useCallback((next: string): void => {
    const normalized = normalizePreviewPath(next);
    if (normalized) updateQuery({ path: normalized }, true);
  }, [updateQuery]);
  const sectionChange = useCallback((next: DashboardSection): void => {
    updateQuery({ section: next }, true);
  }, [updateQuery]);
  const openDashboardSection = useCallback((next: DashboardSection): void => {
    updateQuery({ panel: 'dashboard', section: next });
  }, [updateQuery]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('pf:studio-chat-hidden', { detail: { hidden: splitPane.hidden } }));
    return () => {
      window.dispatchEvent(new CustomEvent('pf:studio-chat-hidden', { detail: { hidden: false } }));
    };
  }, [splitPane.hidden]);

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="grid h-full place-items-center" role="status">
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            Открываем Project Studio…
          </span>
        </div>
      );
    }
    if (error || !data) {
      return (
        <div className="grid h-full place-items-center px-6 text-center">
          <div className="max-w-md">
            <AlertCircle className="mx-auto size-7 text-destructive" />
            <h1 className="mt-3 text-lg font-semibold">Project Studio не открылся</h1>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{error ?? 'Неизвестная ошибка.'}</p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => setReload((value) => value + 1)}>
              Повторить
            </Button>
          </div>
        </div>
      );
    }
    return null;
  }, [data, error, loading]);

  if (content) return <main className="h-full min-h-[520px] overflow-hidden bg-background">{content}</main>;
  if (!data) throw new Error('Project Studio data invariant failed');

  const projectActions = (
    <>
      {data.members.length > 1 && (
        <MemberAvatarStack
          members={data.members}
          canInvite={canEdit}
          ownerId={data.project.ownerId}
        />
      )}
      <ProjectSharePopover
        project={data.project}
        members={data.members}
        canInvite={canEdit}
        isOwner={data.project.role === 'owner'}
      />
      <ProjectActionsMenu
        project={data.project}
        financeVisible={financeVisible}
        monitoringVisible={monitoringVisible}
        monitoringAlerts={monitoringAlerts}
        onOpenAutomation={() => setAutomationOpen(true)}
        onOpenTaskFromHistory={() => setActivityOpen(false)}
      />
    </>
  );

  return (
    <main className="flex h-full min-h-[520px] w-full overflow-hidden bg-background" aria-label={`Project Studio — ${data.project.name}`}>
      <StudioChatPane conversationId={data.conversationId} projectName={data.project.name} splitPane={splitPane} onOpenDashboardSection={openDashboardSection} />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label="Рабочая область проекта">
        {panel === 'dashboard' && (
          <StudioTopBar
            panel={panel}
            projectId={data.project.id}
            projectName={data.project.name}
            actions={(
              <>
                <ProjectActivityButton
                  projectId={data.project.id}
                  actions={projectActions}
                  open={activityOpen}
                  onOpenChange={setActivityOpen}
                />
                {!activityOpen && projectActions}
              </>
            )}
            chatHidden={splitPane.hidden}
            onPanelChange={panelChange}
            onShowChat={() => splitPane.setHidden(false)}
            onOpenMobileChat={() => setMobileChatOpen(true)}
          />
        )}
        <StudioWorkspace
          panel={panel}
          project={data.project}
          members={data.members}
          canEdit={canEdit}
          path={path}
          section={section}
          onPathChange={pathChange}
          onSectionChange={sectionChange}
          onOpenPreview={() => panelChange('preview')}
          onOpenAutomation={() => setAutomationOpen(true)}
          previewToolbarLeading={(
            <StudioTopBar
              panel={panel}
              projectId={data.project.id}
              projectName={data.project.name}
              chatHidden={splitPane.hidden}
              onPanelChange={panelChange}
              onShowChat={() => splitPane.setHidden(false)}
              onOpenMobileChat={() => setMobileChatOpen(true)}
              embedded="leading"
            />
          )}
          previewToolbarTrailing={(
            <StudioTopBar
              panel={panel}
              projectId={data.project.id}
              projectName={data.project.name}
              actions={(
                <>
                  <ProjectActivityButton
                    projectId={data.project.id}
                    actions={projectActions}
                    open={activityOpen}
                    onOpenChange={setActivityOpen}
                    compact
                  />
                  {!activityOpen && projectActions}
                </>
              )}
              chatHidden={splitPane.hidden}
              onPanelChange={panelChange}
              onShowChat={() => splitPane.setHidden(false)}
              onOpenMobileChat={() => setMobileChatOpen(true)}
              embedded="trailing"
            />
          )}
        />
      </section>

      <StudioMobileChatSheet
        open={mobileChatOpen}
        onOpenChange={setMobileChatOpen}
        conversationId={data.conversationId}
        projectName={data.project.name}
      />
      <AutomationDialog
        open={automationOpen}
        onOpenChange={setAutomationOpen}
        projectId={data.project.id}
        hasDispatcher={data.project.dispatcherUserId !== null}
        multiTaskWorker={data.project.multiTaskWorker}
      />
    </main>
  );
}
