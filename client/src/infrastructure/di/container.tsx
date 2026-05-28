import { createContext, useContext, type ReactNode } from 'react';
import { HttpProjectRepository } from '@/infrastructure/http/HttpProjectRepository';
import { HttpUserRepository } from '@/infrastructure/http/HttpUserRepository';
import { HttpAuthRepository } from '@/infrastructure/http/HttpAuthRepository';
import { HttpGithubRepository } from '@/infrastructure/http/HttpGithubRepository';
import { HttpKbRepository } from '@/infrastructure/http/HttpKbRepository';
import { HttpSecretsRepository } from '@/infrastructure/http/HttpSecretsRepository';
import { HttpTaskRepository } from '@/infrastructure/http/HttpTaskRepository';
import { HttpTaskDelegationRepository } from '@/infrastructure/http/HttpTaskDelegationRepository';
import { HttpTaskSearchRepository } from '@/infrastructure/http/HttpTaskSearchRepository';
import { HttpInviteRepository } from '@/infrastructure/http/HttpInviteRepository';
import { HttpNotificationRepository } from '@/infrastructure/http/HttpNotificationRepository';
import { HttpAgentTokenRepository } from '@/infrastructure/http/HttpAgentTokenRepository';
import { HttpAgentDeviceRepository } from '@/infrastructure/http/HttpAgentDeviceRepository';
import { HttpAgentJobRepository } from '@/infrastructure/http/HttpAgentJobRepository';
import { HttpAdminRepository } from '@/infrastructure/http/HttpAdminRepository';
import { HttpEmployeeRepository } from '@/infrastructure/http/HttpEmployeeRepository';
import { HttpProjectFinanceRepository } from '@/infrastructure/http/HttpProjectFinanceRepository';
import { HttpTelegramRepository } from '@/infrastructure/http/HttpTelegramRepository';
import { EnqueueAgentJob } from '@/application/agentJob/EnqueueAgentJob';
import { CancelAgentJob } from '@/application/agentJob/CancelAgentJob';
import { SearchTasks } from '@/application/task/SearchTasks';
import { ListProjects } from '@/application/project/ListProjects';
import { GetProject } from '@/application/project/GetProject';
import { CreateProject } from '@/application/project/CreateProject';
import { UpdateProject } from '@/application/project/UpdateProject';
import { ReorderProjects } from '@/application/project/ReorderProjects';
import { ToggleProjectFavorite } from '@/application/project/ToggleProjectFavorite';
import { ReorderFavoriteProjects } from '@/application/project/ReorderFavoriteProjects';
import { GetCurrentUser } from '@/application/user/GetCurrentUser';
import { UpdateProfile } from '@/application/user/UpdateProfile';
import type { AuthRepository } from '@/application/auth/AuthRepository';
import type { ProjectRepository } from '@/application/project/ProjectRepository';
import type { GithubRepository } from '@/application/github/GithubRepository';
import type { KbRepository } from '@/application/kb/KbRepository';
import type { SecretsRepository } from '@/application/secrets/SecretsRepository';
import type { TaskRepository } from '@/application/task/TaskRepository';
import type { TaskDelegationRepository } from '@/application/task/TaskDelegationRepository';
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
  searchTasks: SearchTasks;
  projectRepository: ProjectRepository;
  authRepository: AuthRepository;
  githubRepository: GithubRepository;
  kbRepository: KbRepository;
  secretsRepository: SecretsRepository;
  taskRepository: TaskRepository;
  taskDelegationRepository: TaskDelegationRepository;
  inviteRepository: InviteRepository;
  notificationRepository: NotificationRepository;
  agentTokenRepository: AgentTokenRepository;
  agentDeviceRepository: AgentDeviceRepository;
  adminRepository: AdminRepository;
  employeeRepository: EmployeeRepository;
  projectFinanceRepository: ProjectFinanceRepository;
  telegramRepository: TelegramRepository;
  enqueueAgentJob: EnqueueAgentJob;
  cancelAgentJob: CancelAgentJob;
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
  const taskSearchRepo = new HttpTaskSearchRepository();
  const inviteRepo = new HttpInviteRepository();
  const notificationRepo = new HttpNotificationRepository();
  const agentTokenRepo = new HttpAgentTokenRepository();
  const agentDeviceRepo = new HttpAgentDeviceRepository();
  const agentJobRepo = new HttpAgentJobRepository();
  const adminRepo = new HttpAdminRepository();
  const employeeRepo = new HttpEmployeeRepository();
  const projectFinanceRepo = new HttpProjectFinanceRepository();
  const telegramRepo = new HttpTelegramRepository();
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
    searchTasks: new SearchTasks(taskSearchRepo),
    projectRepository: projectRepo,
    authRepository: authRepo,
    githubRepository: githubRepo,
    kbRepository: kbRepo,
    secretsRepository: secretsRepo,
    taskRepository: taskRepo,
    taskDelegationRepository: taskDelegationRepo,
    inviteRepository: inviteRepo,
    notificationRepository: notificationRepo,
    agentTokenRepository: agentTokenRepo,
    agentDeviceRepository: agentDeviceRepo,
    adminRepository: adminRepo,
    employeeRepository: employeeRepo,
    projectFinanceRepository: projectFinanceRepo,
    telegramRepository: telegramRepo,
    enqueueAgentJob: new EnqueueAgentJob(agentJobRepo),
    cancelAgentJob: new CancelAgentJob(agentJobRepo),
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
