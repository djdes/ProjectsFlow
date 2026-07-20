import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import type { AiSelectionRef } from '@/domain/ai-chat/AiSelectionRef';
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
  EMPTY_SAVE_STATE,
  type StudioPanel,
  type StudioSaveState,
  useStudioSplitPane,
} from '@/presentation/components/project/studio';
import {
  resolveDashboardSection,
  type DashboardSection,
} from '@/presentation/components/project/workspace/dashboard/dashboardConfig';
import { normalizePreviewPath } from '@/presentation/components/project/workspace/preview/path';
import type { PreviewEditRequest, PreviewSelectionRequest } from '@/presentation/components/project/workspace/ProjectPreview';

type StudioData = {
  project: Project;
  members: ProjectMember[];
  conversationId: string;
};

function resolvePanel(value: string | null): StudioPanel {
  return value === 'dashboard' ? 'dashboard' : 'preview';
}

// Отличает «фичи тут нет / нет доступа» от сетевого сбоя. Прятать блок надо только в первом
// случае: при обрыве связи блок должен остаться на месте, иначе временный сбой неотличим от
// отсутствия прав и раздел молча пропадает из интерфейса.
// Проверка по duck-typing, а не через instanceof HttpError: presentation не имеет права
// импортировать из infrastructure/http (см. CLAUDE.md → «Архитектура client/»).
function featureUnavailable(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 403 || status === 404;
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
  // Статус сохранения правок превью: живёт в правой панели, показывается в шапке левой.
  const [saveState, setSaveState] = useState<StudioSaveState>(EMPTY_SAVE_STATE);
  const [financeVisible, setFinanceVisible] = useState(false);
  const [monitoringVisible, setMonitoringVisible] = useState(false);
  const [monitoringAlerts, setMonitoringAlerts] = useState(0);
  // Зона, которую попросили выделить из чата. Живёт здесь, потому что переход к ней —
  // это смена panel/path, а ими владеет страница.
  const [requestedSelection, setRequestedSelection] = useState<PreviewSelectionRequest | null>(null);
  // Обратное направление: что выделено в превью прямо сейчас. Поднято тем же приёмом,
  // что и статус сохранения, — иначе левый чат не может знать, к чему привяжет правку.
  const [selection, setSelection] = useState<AiSelectionRef | null>(null);
  // И третий канал: промпт из чата, который должно выполнить превью (см. PreviewEditRequest).
  const [editRequest, setEditRequest] = useState<PreviewEditRequest | null>(null);
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
      .catch((err: unknown) => { if (!cancelled && featureUnavailable(err)) setFinanceVisible(false); });
    monitoringRepository.listServers(projectId)
      .then(() => { if (!cancelled) setMonitoringVisible(true); })
      .catch((err: unknown) => { if (!cancelled && featureUnavailable(err)) setMonitoringVisible(false); });
    monitoringRepository.listAlerts(projectId, true)
      .then((alerts) => { if (!cancelled) setMonitoringAlerts(alerts.length); })
      .catch(() => { if (!cancelled) setMonitoringAlerts(0); });
    return () => { cancelled = true; };
  }, [monitoringRepository, projectFinanceRepository, projectId]);

  const canEdit = data?.project.role !== 'viewer';
  // Запрос на зону одноразовый. Превью пересоздаётся при переключении панелей, поэтому
  // без сброса возврат с дашборда снова включал бы Edit и выделял то, о чём просили
  // давно. Сам openSelection ходит в updateQuery напрямую и своего запроса не гасит.
  const panelChange = useCallback((next: StudioPanel): void => {
    setRequestedSelection(null);
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
    setRequestedSelection(null);
    updateQuery({ panel: 'dashboard', section: next });
  }, [updateQuery]);
  // Клик по чипу зоны в сообщении: открываем предпросмотр на той же странице и просим
  // его войти в Edit и выделить элемент. Токен — нонс: повторный клик по тому же чипу
  // обязан сработать снова, поэтому пересобираем запрос с новым номером.
  const openSelection = useCallback((target: AiSelectionRef): void => {
    const route = normalizePreviewPath(target.route) ?? '/';
    setMobileChatOpen(false);
    updateQuery({ panel: 'preview', path: route });
    setRequestedSelection((current) => ({ selector: target.selector, route, token: (current?.token ?? 0) + 1 }));
  }, [updateQuery]);
  // Отправка из левого чата в режиме «Правка». Сам job создаёт превью — здесь только
  // передача промпта: тот же нонс-приём, повторный одинаковый промпт обязан сработать.
  // Промис живёт до ответа превью: не приняло правку — чат покажет причину, а композер
  // по этому же реджекту вернёт набранный текст в поле.
  const requestEdit = useCallback((prompt: string): Promise<void> => {
    // Исполнитель запроса — смонтированное превью. С открытым дашбордом его нет, и
    // обещание не сдержал бы никто: композер ждал бы ответа вечно, а промпт при этом
    // уже стёрт из поля. Отвечаем сразу — чат покажет причину и вернёт текст.
    if (panel !== 'preview') {
      return Promise.reject(new Error('Откройте предпросмотр — правка применяется к выделенной зоне.'));
    }
    return new Promise<void>((resolve, reject) => {
      setEditRequest((current) => ({
        prompt,
        token: (current?.token ?? 0) + 1,
        onSettled: (error) => { if (error) reject(new Error(error)); else resolve(); },
      }));
    });
  }, [panel]);

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
        mode="studio"
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
      <StudioChatPane conversationId={data.conversationId} projectId={data.project.id} projectName={data.project.name} projectIcon={data.project.icon} splitPane={splitPane} saveState={saveState} onOpenDashboardSection={openDashboardSection} onOpenSelection={openSelection} selection={selection} onBuild={requestEdit} />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label="Рабочая область проекта">
        {panel === 'dashboard' && (
          <StudioTopBar
            panel={panel}
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
          onSaveStateChange={setSaveState}
          requestedSelection={requestedSelection}
          onSelectionChange={setSelection}
          editRequest={editRequest}
          onEditRunStarted={() => splitPane.setHidden(false)}
          previewToolbarLeading={(
            <StudioTopBar
              panel={panel}
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
        projectId={data.project.id}
        projectName={data.project.name}
        onOpenSelection={openSelection}
        selection={selection}
        onBuild={requestEdit}
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
