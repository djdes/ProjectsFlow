import { createContext, useContext, type ReactNode } from 'react';
import { HttpProjectRepository } from '@/infrastructure/http/HttpProjectRepository';
import { HttpUserRepository } from '@/infrastructure/http/HttpUserRepository';
import { HttpAuthRepository } from '@/infrastructure/http/HttpAuthRepository';
import { HttpGithubRepository } from '@/infrastructure/http/HttpGithubRepository';
import { HttpKbRepository } from '@/infrastructure/http/HttpKbRepository';
import { HttpSecretsRepository } from '@/infrastructure/http/HttpSecretsRepository';
import { HttpTaskRepository } from '@/infrastructure/http/HttpTaskRepository';
import { HttpTaskDelegationRepository } from '@/infrastructure/http/HttpTaskDelegationRepository';
import { HttpDigestSettingsRepository } from '@/infrastructure/http/HttpDigestSettingsRepository';
import { HttpTaskSearchRepository } from '@/infrastructure/http/HttpTaskSearchRepository';
import { HttpInviteRepository } from '@/infrastructure/http/HttpInviteRepository';
import { HttpNotificationRepository } from '@/infrastructure/http/HttpNotificationRepository';
import { HttpAgentTokenRepository } from '@/infrastructure/http/HttpAgentTokenRepository';
import { HttpAgentDeviceRepository } from '@/infrastructure/http/HttpAgentDeviceRepository';
import { HttpAiPromptRepository } from '@/infrastructure/http/HttpAiPromptRepository';
import { HttpAutomationRepository } from '@/infrastructure/http/HttpAutomationRepository';
import { HttpAdminRepository } from '@/infrastructure/http/HttpAdminRepository';
import { HttpEmployeeRepository } from '@/infrastructure/http/HttpEmployeeRepository';
import { HttpProjectFinanceRepository } from '@/infrastructure/http/HttpProjectFinanceRepository';
import { HttpTelegramRepository } from '@/infrastructure/http/HttpTelegramRepository';
import { HttpMonitoringRepository } from '@/infrastructure/http/HttpMonitoringRepository';
import { HttpLiveRepository } from '@/infrastructure/http/HttpLiveRepository';
import { HttpChatRepository } from '@/infrastructure/http/HttpChatRepository';
import { HttpWorkspaceRepository } from '@/infrastructure/http/HttpWorkspaceRepository';
import { HttpActivityRepository } from '@/infrastructure/http/HttpActivityRepository';
import { HttpRecentTaskViewRepository } from '@/infrastructure/http/HttpRecentTaskViewRepository';
import { HttpBoardViewRepository } from '@/infrastructure/http/HttpBoardViewRepository';
import { HttpHelpRepository } from '@/infrastructure/http/HttpHelpRepository';
import { SubmitSupport } from '@/application/help/SubmitSupport';
import type { HelpRepository } from '@/application/help/HelpRepository';
import { RecordTaskView } from '@/application/recent/RecordTaskView';
import { ListRecentTaskViews } from '@/application/recent/ListRecentTaskViews';
import { ImproveTaskDescription } from '@/application/ai/ImproveTaskDescription';
import { ComposeTasks } from '@/application/ai/ComposeTasks';
import type { AiPromptRepository } from '@/application/ai/AiPromptRepository';
import type { AutomationRepository } from '@/application/automation/AutomationRepository';
import { SearchTasks } from '@/application/task/SearchTasks';
import { ListProjects } from '@/application/project/ListProjects';
import { ListWorkspaces } from '@/application/workspace/ListWorkspaces';
import { CreateWorkspace } from '@/application/workspace/CreateWorkspace';
import { GetActivityFeed } from '@/application/activity/GetActivityFeed';
import { GetProject } from '@/application/project/GetProject';
import { CreateProject } from '@/application/project/CreateProject';
import { UpdateProject } from '@/application/project/UpdateProject';
import { ReorderProjects } from '@/application/project/ReorderProjects';
import { ToggleProjectFavorite } from '@/application/project/ToggleProjectFavorite';
import { ReorderFavoriteProjects } from '@/application/project/ReorderFavoriteProjects';
import { GetCurrentUser } from '@/application/user/GetCurrentUser';
import { UpdateProfile } from '@/application/user/UpdateProfile';
import { UploadAvatar } from '@/application/user/UploadAvatar';
import type { AuthRepository } from '@/application/auth/AuthRepository';
import type { ProjectRepository } from '@/application/project/ProjectRepository';
import type { GithubRepository } from '@/application/github/GithubRepository';
import type { KbRepository } from '@/application/kb/KbRepository';
import type { SecretsRepository } from '@/application/secrets/SecretsRepository';
import type { TaskRepository } from '@/application/task/TaskRepository';
import type { TaskDelegationRepository } from '@/application/task/TaskDelegationRepository';
import type { DigestSettingsRepository } from '@/application/digest/DigestSettingsRepository';
import type { InviteRepository } from '@/application/project/InviteRepository';
import type { NotificationRepository } from '@/application/notifications/NotificationRepository';
import type { AgentTokenRepository } from '@/application/agent/AgentTokenRepository';
import type { AgentDeviceRepository } from '@/application/agent/AgentDeviceRepository';
import type { AdminRepository } from '@/application/admin/AdminRepository';
import type {
  EmployeeRepository,
  ProjectFinanceRepository,
} from '@/application/finance/FinanceRepository';
import type { TelegramRepository } from '@/application/telegram/TelegramRepository';
import type { MonitoringRepository } from '@/application/monitoring/MonitoringRepository';
import type { LiveRepository } from '@/application/live/LiveRepository';
import type { ChatRepository } from '@/application/chat/ChatRepository';
import type { UserRepository } from '@/application/user/UserRepository';
import type { WorkspaceRepository } from '@/application/workspace/WorkspaceRepository';
import type { ActivityRepository } from '@/application/activity/ActivityRepository';
import { HttpUsageRepository } from '@/infrastructure/http/HttpUsageRepository';
import { HttpPublicBoardRepository } from '@/infrastructure/http/HttpPublicBoardRepository';
import type { PublicBoardRepository } from '@/application/public/PublicBoardRepository';
import type { BoardViewRepository } from '@/application/project/BoardViewRepository';
import { GetUsage } from '@/application/usage/GetUsage';
import { ChangePlan } from '@/application/usage/ChangePlan';
import type { UsageRepository } from '@/application/usage/UsageRepository';

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
  projectRepository: ProjectRepository;
  authRepository: AuthRepository;
  githubRepository: GithubRepository;
  kbRepository: KbRepository;
  secretsRepository: SecretsRepository;
  taskRepository: TaskRepository;
  taskDelegationRepository: TaskDelegationRepository;
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
  improveTaskDescription: ImproveTaskDescription;
  composeTasks: ComposeTasks;
  automationRepository: AutomationRepository;
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
};

function buildContainer(): Container {
  const projectRepo = new HttpProjectRepository();
  const userRepo = new HttpUserRepository();
  const authRepo = new HttpAuthRepository();
  const githubRepo = new HttpGithubRepository();
  const kbRepo = new HttpKbRepository();
  const secretsRepo = new HttpSecretsRepository();
  const taskRepo = new HttpTaskRepository();
  const taskDelegationRepo = new HttpTaskDelegationRepository();
  const digestSettingsRepo = new HttpDigestSettingsRepository();
  const taskSearchRepo = new HttpTaskSearchRepository();
  const inviteRepo = new HttpInviteRepository();
  const notificationRepo = new HttpNotificationRepository();
  const agentTokenRepo = new HttpAgentTokenRepository();
  const agentDeviceRepo = new HttpAgentDeviceRepository();
  const aiPromptRepo = new HttpAiPromptRepository();
  const automationRepo = new HttpAutomationRepository();
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
    projectRepository: projectRepo,
    authRepository: authRepo,
    githubRepository: githubRepo,
    kbRepository: kbRepo,
    secretsRepository: secretsRepo,
    taskRepository: taskRepo,
    taskDelegationRepository: taskDelegationRepo,
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
    improveTaskDescription: new ImproveTaskDescription(aiPromptRepo),
    composeTasks: new ComposeTasks(aiPromptRepo),
    automationRepository: automationRepo,
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
  };
}

// Module-level singleton.
const container: Container = buildContainer();

const ContainerCtx = createContext<Container | null>(null);

export function ContainerProvider({ children }: { children: ReactNode }): React.ReactElement {
  return <ContainerCtx.Provider value={container}>{children}</ContainerCtx.Provider>;
}

export function useContainer(): Container {
  const c = useContext(ContainerCtx);
  if (!c) throw new Error('useContainer must be used inside <ContainerProvider>');
  return c;
}
