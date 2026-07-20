import { createContext, useContext, type ReactNode } from "react";
import { HttpProjectRepository } from "@/infrastructure/http/HttpProjectRepository";
import { HttpUserRepository } from "@/infrastructure/http/HttpUserRepository";
import { HttpAuthRepository } from "@/infrastructure/http/HttpAuthRepository";
import { HttpGithubRepository } from "@/infrastructure/http/HttpGithubRepository";
import { HttpKbRepository } from "@/infrastructure/http/HttpKbRepository";
import { HttpSecretsRepository } from "@/infrastructure/http/HttpSecretsRepository";
import { HttpTaskRepository } from "@/infrastructure/http/HttpTaskRepository";
import { HttpTaskAssigneeRepository } from "@/infrastructure/http/HttpTaskAssigneeRepository";
import { HttpDigestSettingsRepository } from "@/infrastructure/http/HttpDigestSettingsRepository";
import { HttpTaskSearchRepository } from "@/infrastructure/http/HttpTaskSearchRepository";
import { HttpInviteRepository } from "@/infrastructure/http/HttpInviteRepository";
import { HttpNotificationRepository } from "@/infrastructure/http/HttpNotificationRepository";
import { HttpAgentTokenRepository } from "@/infrastructure/http/HttpAgentTokenRepository";
import { HttpAgentDeviceRepository } from "@/infrastructure/http/HttpAgentDeviceRepository";
import { HttpAiPromptRepository } from "@/infrastructure/http/HttpAiPromptRepository";
import { HttpAutomationRepository } from "@/infrastructure/http/HttpAutomationRepository";
import { HttpWorkflowRepository } from "@/infrastructure/http/HttpWorkflowRepository";
import { HttpAdminRepository } from "@/infrastructure/http/HttpAdminRepository";
import { HttpEmployeeRepository } from "@/infrastructure/http/HttpEmployeeRepository";
import { HttpProjectFinanceRepository } from "@/infrastructure/http/HttpProjectFinanceRepository";
import { HttpTelegramRepository } from "@/infrastructure/http/HttpTelegramRepository";
import { HttpMonitoringRepository } from "@/infrastructure/http/HttpMonitoringRepository";
import { HttpLiveRepository } from "@/infrastructure/http/HttpLiveRepository";
import { HttpChatRepository } from "@/infrastructure/http/HttpChatRepository";
import { HttpWorkspaceRepository } from "@/infrastructure/http/HttpWorkspaceRepository";
import { HttpActivityRepository } from "@/infrastructure/http/HttpActivityRepository";
import { HttpRecentTaskViewRepository } from "@/infrastructure/http/HttpRecentTaskViewRepository";
import { HttpBoardViewRepository } from "@/infrastructure/http/HttpBoardViewRepository";
import { HttpTaskTemplateRepository } from "@/infrastructure/http/HttpTaskTemplateRepository";
import { HttpTaskPropertyRepository } from "@/infrastructure/http/HttpTaskPropertyRepository";
import { HttpSiteEditorRepository } from "@/infrastructure/http/HttpSiteEditorRepository";
import { HttpProjectCodeRepository } from "@/infrastructure/http/HttpProjectCodeRepository";
import { HttpHelpRepository } from "@/infrastructure/http/HttpHelpRepository";
import { HttpAiConversationRepository } from "@/infrastructure/http/HttpAiConversationRepository";
import { SubmitSupport } from "@/application/help/SubmitSupport";
import type { HelpRepository } from "@/application/help/HelpRepository";
import { RecordTaskView } from "@/application/recent/RecordTaskView";
import { ListRecentTaskViews } from "@/application/recent/ListRecentTaskViews";
import { ImproveTaskDescription } from "@/application/ai/ImproveTaskDescription";
import { ComposeTasks } from "@/application/ai/ComposeTasks";
import type { AiPromptRepository } from "@/application/ai/AiPromptRepository";
import type { AutomationRepository } from "@/application/automation/AutomationRepository";
import type { WorkflowRepository } from "@/application/automation/WorkflowRepository";
import { SearchTasks } from "@/application/task/SearchTasks";
import { ResolveDestructiveTargets } from "@/application/ai-action/ResolveDestructiveTargets";
import { ListProjects } from "@/application/project/ListProjects";
import { ListWorkspaces } from "@/application/workspace/ListWorkspaces";
import { CreateWorkspace } from "@/application/workspace/CreateWorkspace";
import { GetActivityFeed } from "@/application/activity/GetActivityFeed";
import { GetProject } from "@/application/project/GetProject";
import { CreateProject } from "@/application/project/CreateProject";
import { UpdateProject } from "@/application/project/UpdateProject";
import { ReorderProjects } from "@/application/project/ReorderProjects";
import { ToggleProjectFavorite } from "@/application/project/ToggleProjectFavorite";
import { ReorderFavoriteProjects } from "@/application/project/ReorderFavoriteProjects";
import { GetCurrentUser } from "@/application/user/GetCurrentUser";
import { UpdateProfile } from "@/application/user/UpdateProfile";
import { UploadAvatar } from "@/application/user/UploadAvatar";
import type { AuthRepository } from "@/application/auth/AuthRepository";
import type { ProjectRepository } from "@/application/project/ProjectRepository";
import type { GithubRepository } from "@/application/github/GithubRepository";
import type { KbRepository } from "@/application/kb/KbRepository";
import type { SecretsRepository } from "@/application/secrets/SecretsRepository";
import type { TaskRepository } from "@/application/task/TaskRepository";
import type { TaskAssigneeRepository } from "@/application/task/TaskAssigneeRepository";
import type { DigestSettingsRepository } from "@/application/digest/DigestSettingsRepository";
import type { InviteRepository } from "@/application/project/InviteRepository";
import type { NotificationRepository } from "@/application/notifications/NotificationRepository";
import type { AgentTokenRepository } from "@/application/agent/AgentTokenRepository";
import type { AgentDeviceRepository } from "@/application/agent/AgentDeviceRepository";
import type { AdminRepository } from "@/application/admin/AdminRepository";
import type {
  EmployeeRepository,
  ProjectFinanceRepository,
} from "@/application/finance/FinanceRepository";
import type { TelegramRepository } from "@/application/telegram/TelegramRepository";
import type { MonitoringRepository } from "@/application/monitoring/MonitoringRepository";
import type { LiveRepository } from "@/application/live/LiveRepository";
import type { ChatRepository } from "@/application/chat/ChatRepository";
import type { UserRepository } from "@/application/user/UserRepository";
import type { WorkspaceRepository } from "@/application/workspace/WorkspaceRepository";
import type { ActivityRepository } from "@/application/activity/ActivityRepository";
import { HttpUsageRepository } from "@/infrastructure/http/HttpUsageRepository";
import { HttpPublicBoardRepository } from "@/infrastructure/http/HttpPublicBoardRepository";
import type { PublicBoardRepository } from "@/application/public/PublicBoardRepository";
import type { BoardViewRepository } from "@/application/project/BoardViewRepository";
import type { TaskTemplateRepository } from "@/application/task/TaskTemplateRepository";
import type { TaskPropertyRepository } from "@/application/task/TaskPropertyRepository";
import type { SiteEditorRepository } from "@/application/site-editor/SiteEditorRepository";
import type { ProjectCodeRepository } from "@/application/project-code/ProjectCodeRepository";
import { OpenSiteEditorSession } from "@/application/site-editor/OpenSiteEditorSession";
import { ApplySiteEditorPatch } from "@/application/site-editor/ApplySiteEditorPatch";
import { StartSiteEditorAiJob } from "@/application/site-editor/StartSiteEditorAiJob";
import { GetUsage } from "@/application/usage/GetUsage";
import { ChangePlan } from "@/application/usage/ChangePlan";
import type { UsageRepository } from "@/application/usage/UsageRepository";
import type { AiConversationRepository } from "@/application/ai-chat/AiConversationRepository";
import type { AiActionBatchRepository } from "@/application/ai-action/AiActionBatchRepository";
import { HttpAiActionBatchRepository } from "@/infrastructure/http/HttpAiActionBatchRepository";

type Container = {
  listProjects: ListProjects;
  getProject: GetProject;
  createProject: CreateProject;
  updateProject: UpdateProject;
  reorderProjects: ReorderProjects;
  toggleProjectFavorite: ToggleProjectFavorite;
  reorderFavoriteProjects: ReorderFavoriteProjects;
  getCurrentUser: GetCurrentUser;
  updateProfile: UpdateProfile;
  uploadAvatar: UploadAvatar;
  searchTasks: SearchTasks;
  resolveDestructiveTargets: ResolveDestructiveTargets;
  projectRepository: ProjectRepository;
  projectCodeRepository: ProjectCodeRepository;
  authRepository: AuthRepository;
  githubRepository: GithubRepository;
  kbRepository: KbRepository;
  secretsRepository: SecretsRepository;
  taskRepository: TaskRepository;
  taskAssigneeRepository: TaskAssigneeRepository;
  digestSettingsRepository: DigestSettingsRepository;
  inviteRepository: InviteRepository;
  notificationRepository: NotificationRepository;
  agentTokenRepository: AgentTokenRepository;
  agentDeviceRepository: AgentDeviceRepository;
  adminRepository: AdminRepository;
  employeeRepository: EmployeeRepository;
  projectFinanceRepository: ProjectFinanceRepository;
  telegramRepository: TelegramRepository;
  monitoringRepository: MonitoringRepository;
  liveRepository: LiveRepository;
  chatRepository: ChatRepository;
  aiPromptRepository: AiPromptRepository;
  aiConversationRepository: AiConversationRepository;
  aiActionBatchRepository: AiActionBatchRepository;
  improveTaskDescription: ImproveTaskDescription;
  composeTasks: ComposeTasks;
  automationRepository: AutomationRepository;
  workflowRepository: WorkflowRepository;
  userRepository: UserRepository;
  listWorkspaces: ListWorkspaces;
  createWorkspace: CreateWorkspace;
  workspaceRepository: WorkspaceRepository;
  getActivityFeed: GetActivityFeed;
  activityRepository: ActivityRepository;
  recordTaskView: RecordTaskView;
  listRecentTaskViews: ListRecentTaskViews;
  helpRepository: HelpRepository;
  submitSupport: SubmitSupport;
  usageRepository: UsageRepository;
  getUsage: GetUsage;
  changePlan: ChangePlan;
  publicBoardRepository: PublicBoardRepository;
  boardViewRepository: BoardViewRepository;
  taskTemplateRepository: TaskTemplateRepository;
  taskPropertyRepository: TaskPropertyRepository;
  siteEditorRepository: SiteEditorRepository;
  openSiteEditorSession: OpenSiteEditorSession;
  applySiteEditorPatch: ApplySiteEditorPatch;
  startSiteEditorAiJob: StartSiteEditorAiJob;
};

function buildContainer(): Container {
  const projectRepo = new HttpProjectRepository();
  const projectCodeRepo = new HttpProjectCodeRepository();
  const userRepo = new HttpUserRepository();
  const authRepo = new HttpAuthRepository();
  const githubRepo = new HttpGithubRepository();
  const kbRepo = new HttpKbRepository();
  const secretsRepo = new HttpSecretsRepository();
  const taskRepo = new HttpTaskRepository();
  const taskAssigneeRepo = new HttpTaskAssigneeRepository();
  const digestSettingsRepo = new HttpDigestSettingsRepository();
  const taskSearchRepo = new HttpTaskSearchRepository();
  const inviteRepo = new HttpInviteRepository();
  const notificationRepo = new HttpNotificationRepository();
  const agentTokenRepo = new HttpAgentTokenRepository();
  const agentDeviceRepo = new HttpAgentDeviceRepository();
  const aiPromptRepo = new HttpAiPromptRepository();
  const aiConversationRepo = new HttpAiConversationRepository();
  const aiActionBatchRepo = new HttpAiActionBatchRepository();
  const automationRepo = new HttpAutomationRepository();
  const workflowRepo = new HttpWorkflowRepository();
  const adminRepo = new HttpAdminRepository();
  const employeeRepo = new HttpEmployeeRepository();
  const projectFinanceRepo = new HttpProjectFinanceRepository();
  const telegramRepo = new HttpTelegramRepository();
  const monitoringRepo = new HttpMonitoringRepository();
  const liveRepo = new HttpLiveRepository();
  const chatRepo = new HttpChatRepository();
  const workspaceRepo = new HttpWorkspaceRepository();
  const activityRepo = new HttpActivityRepository();
  const recentTaskViewRepo = new HttpRecentTaskViewRepository();
  const helpRepo = new HttpHelpRepository();
  const usageRepo = new HttpUsageRepository();
  const publicBoardRepo = new HttpPublicBoardRepository();
  const boardViewRepo = new HttpBoardViewRepository();
  const taskTemplateRepo = new HttpTaskTemplateRepository();
  const taskPropertyRepo = new HttpTaskPropertyRepository();
  const siteEditorRepo = new HttpSiteEditorRepository();
  return {
    listProjects: new ListProjects(projectRepo),
    getProject: new GetProject(projectRepo),
    createProject: new CreateProject(projectRepo),
    updateProject: new UpdateProject(projectRepo),
    reorderProjects: new ReorderProjects(projectRepo),
    toggleProjectFavorite: new ToggleProjectFavorite(projectRepo),
    reorderFavoriteProjects: new ReorderFavoriteProjects(projectRepo),
    getCurrentUser: new GetCurrentUser(userRepo),
    updateProfile: new UpdateProfile(userRepo),
    uploadAvatar: new UploadAvatar(userRepo),
    searchTasks: new SearchTasks(taskSearchRepo),
    resolveDestructiveTargets: new ResolveDestructiveTargets(taskRepo),
    projectRepository: projectRepo,
    projectCodeRepository: projectCodeRepo,
    authRepository: authRepo,
    githubRepository: githubRepo,
    kbRepository: kbRepo,
    secretsRepository: secretsRepo,
    taskRepository: taskRepo,
    taskAssigneeRepository: taskAssigneeRepo,
    digestSettingsRepository: digestSettingsRepo,
    inviteRepository: inviteRepo,
    notificationRepository: notificationRepo,
    agentTokenRepository: agentTokenRepo,
    agentDeviceRepository: agentDeviceRepo,
    adminRepository: adminRepo,
    employeeRepository: employeeRepo,
    projectFinanceRepository: projectFinanceRepo,
    telegramRepository: telegramRepo,
    monitoringRepository: monitoringRepo,
    liveRepository: liveRepo,
    chatRepository: chatRepo,
    aiPromptRepository: aiPromptRepo,
    aiConversationRepository: aiConversationRepo,
    aiActionBatchRepository: aiActionBatchRepo,
    improveTaskDescription: new ImproveTaskDescription(aiPromptRepo),
    composeTasks: new ComposeTasks(aiPromptRepo),
    automationRepository: automationRepo,
    workflowRepository: workflowRepo,
    userRepository: userRepo,
    listWorkspaces: new ListWorkspaces(workspaceRepo),
    createWorkspace: new CreateWorkspace(workspaceRepo),
    workspaceRepository: workspaceRepo,
    getActivityFeed: new GetActivityFeed(activityRepo),
    activityRepository: activityRepo,
    recordTaskView: new RecordTaskView(recentTaskViewRepo),
    listRecentTaskViews: new ListRecentTaskViews(recentTaskViewRepo),
    helpRepository: helpRepo,
    submitSupport: new SubmitSupport(helpRepo),
    usageRepository: usageRepo,
    getUsage: new GetUsage(usageRepo),
    changePlan: new ChangePlan(usageRepo),
    publicBoardRepository: publicBoardRepo,
    boardViewRepository: boardViewRepo,
    taskTemplateRepository: taskTemplateRepo,
    taskPropertyRepository: taskPropertyRepo,
    siteEditorRepository: siteEditorRepo,
    openSiteEditorSession: new OpenSiteEditorSession(siteEditorRepo),
    applySiteEditorPatch: new ApplySiteEditorPatch(siteEditorRepo),
    startSiteEditorAiJob: new StartSiteEditorAiJob(siteEditorRepo),
  };
}

// Module-level singleton.
const container: Container = buildContainer();

const ContainerCtx = createContext<Container | null>(null);

export function ContainerProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  return (
    <ContainerCtx.Provider value={container}>{children}</ContainerCtx.Provider>
  );
}

export function useContainer(): Container {
  const c = useContext(ContainerCtx);
  if (!c)
    throw new Error("useContainer must be used inside <ContainerProvider>");
  return c;
}
