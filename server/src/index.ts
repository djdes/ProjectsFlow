// Composition root: собираем зависимости + поднимаем HTTP-сервер.

import { db, pool } from './infrastructure/db/index.js';
import { Argon2PasswordHasher } from './infrastructure/crypto/Argon2PasswordHasher.js';
import { idGenerator, shortIdGenerator } from './infrastructure/id/idGenerator.js';
import { FileSystemBlobStorage } from './infrastructure/storage/FileSystemBlobStorage.js';
import { DrizzleFileSyncRepository } from './infrastructure/repositories/DrizzleFileSyncRepository.js';
import { FileSyncService } from './application/file-sync/FileSyncService.js';
import { DrizzleLiveRepository } from './infrastructure/repositories/DrizzleLiveRepository.js';
import { LiveService } from './application/live/LiveService.js';
import { LiveEventHub } from './infrastructure/realtime/LiveEventHub.js';
import { ChatService } from './application/chat/ChatService.js';
import { ChatEventHub } from './infrastructure/realtime/ChatEventHub.js';
import { DrizzleChatRepository } from './infrastructure/repositories/DrizzleChatRepository.js';
import { WorkspaceEventBroadcaster } from './application/realtime/WorkspaceEventBroadcaster.js';
import { DispatchChatMentionNotifications } from './application/chat/DispatchChatMentionNotifications.js';
import { DrizzleUserRepository } from './infrastructure/repositories/DrizzleUserRepository.js';
import { DrizzleSessionRepository } from './infrastructure/repositories/DrizzleSessionRepository.js';
import { DrizzleProjectRepository } from './infrastructure/repositories/DrizzleProjectRepository.js';
import { DrizzleProjectMemberRepository } from './infrastructure/repositories/DrizzleProjectMemberRepository.js';
import { DrizzleWorkspaceRepository } from './infrastructure/repositories/DrizzleWorkspaceRepository.js';
import { WorkspaceService } from './application/workspace/WorkspaceService.js';
import { HubMembershipSync } from './application/workspace/HubMembershipSync.js';
import type { WorkspaceKind } from './domain/workspace/Workspace.js';
import { DrizzleActivityRepository } from './infrastructure/repositories/DrizzleActivityRepository.js';
import { ActivityRecorder } from './application/activity/ActivityRecorder.js';
import { GetActivityFeed } from './application/activity/GetActivityFeed.js';
import { DrizzleProjectInviteRepository } from './infrastructure/repositories/DrizzleProjectInviteRepository.js';
import { DrizzleNotificationRepository } from './infrastructure/repositories/DrizzleNotificationRepository.js';
import { DrizzleRecentTaskViewRepository } from './infrastructure/repositories/DrizzleRecentTaskViewRepository.js';
import { DrizzleProjectViewRepository } from './infrastructure/repositories/DrizzleProjectViewRepository.js';
import { RecordProjectView } from './application/project/RecordProjectView.js';
import { GetProjectViewsAnalytics } from './application/project/GetProjectViewsAnalytics.js';
import { GetProjectActivity } from './application/project/GetProjectActivity.js';
import { RecordTaskView } from './application/task/RecordTaskView.js';
import { ListRecentTaskViews } from './application/task/ListRecentTaskViews.js';
import { DrizzleSupportTicketRepository } from './infrastructure/repositories/DrizzleSupportTicketRepository.js';
import { SubmitSupportTicket } from './application/help/SubmitSupportTicket.js';
import { ListAllSupportTickets } from './application/admin/ListAllSupportTickets.js';
import { SetSupportTicketStatus } from './application/admin/SetSupportTicketStatus.js';
import { SetUserPlanAsAdmin } from './application/admin/SetUserPlanAsAdmin.js';
import { NotificationHub } from './infrastructure/notifications/NotificationHub.js';
import { RealtimeHub } from './infrastructure/realtime/RealtimeHub.js';
import { ProjectEventBroadcaster } from './application/realtime/ProjectEventBroadcaster.js';
import { PublishingNotificationRepository } from './infrastructure/notifications/PublishingNotificationRepository.js';
import { SmtpEmailSender } from './infrastructure/email/SmtpEmailSender.js';
import { LoggingEmailSender } from './infrastructure/email/LoggingEmailSender.js';
import type { EmailSender } from './application/notifications/EmailSender.js';
import { DrizzleGithubTokenRepository } from './infrastructure/repositories/DrizzleGithubTokenRepository.js';
import { FetchGithubApiClient } from './infrastructure/github/FetchGithubApiClient.js';
import { DeviceFlowStore } from './infrastructure/github/DeviceFlowStore.js';
import { Register } from './application/auth/Register.js';
import { Login } from './application/auth/Login.js';
import { Logout } from './application/auth/Logout.js';
import { GetCurrentUser } from './application/auth/GetCurrentUser.js';
import { UpdateProfile } from './application/user/UpdateProfile.js';
import { UploadUserAvatar } from './application/user/UploadUserAvatar.js';
import { ListProjects } from './application/project/ListProjects.js';
import { configureAdminBypass } from './application/project/projectAccess.js';
import { GetProject } from './application/project/GetProject.js';
import { CreateProject } from './application/project/CreateProject.js';
import { UpdateProject } from './application/project/UpdateProject.js';
import { ReorderProjects } from './application/project/ReorderProjects.js';
import { ToggleProjectFavorite } from './application/project/ToggleProjectFavorite.js';
import { ReorderFavoriteProjects } from './application/project/ReorderFavoriteProjects.js';
import { ProjectNotificationService } from './application/notifications/ProjectNotificationService.js';
import { DispatchCommentNotifications } from './application/notifications/DispatchCommentNotifications.js';
import { GetCommentNotifications } from './application/task/GetCommentNotifications.js';
import { DrizzleCommentNotificationLogRepository } from './infrastructure/repositories/DrizzleCommentNotificationLogRepository.js';
import { CreateProjectWithGit } from './application/project/CreateProjectWithGit.js';
import { GetOrCreateInbox } from './application/project/GetOrCreateInbox.js';
import { ListProjectMembers } from './application/project/ListProjectMembers.js';
import { RemoveProjectMember } from './application/project/RemoveProjectMember.js';
import { UpdateProjectMemberRole } from './application/project/UpdateProjectMemberRole.js';
import { TransferProjectOwnership } from './application/project/TransferProjectOwnership.js';
import { CreateProjectInvite } from './application/project/CreateProjectInvite.js';
import { ListProjectInvites } from './application/project/ListProjectInvites.js';
import { DeleteProjectInvite } from './application/project/DeleteProjectInvite.js';
import { ListSharedMembers } from './application/project/ListSharedMembers.js';
import { GetInviteByToken } from './application/project/GetInviteByToken.js';
import { AcceptProjectInvite } from './application/project/AcceptProjectInvite.js';
import { CheckGitCollision } from './application/project/CheckGitCollision.js';
import { RequestProjectJoin } from './application/project/RequestProjectJoin.js';
import { ResolveProjectJoinRequest } from './application/project/ResolveProjectJoinRequest.js';
import { DrizzleProjectJoinRequestRepository } from './infrastructure/repositories/DrizzleProjectJoinRequestRepository.js';
import { StartDeviceFlow } from './application/github/StartDeviceFlow.js';
import { PollDeviceFlow } from './application/github/PollDeviceFlow.js';
import { DisconnectGithub } from './application/github/DisconnectGithub.js';
import { ListUserRepos } from './application/github/ListUserRepos.js';
import { ListProjectCommits } from './application/github/ListProjectCommits.js';
import { GithubKbRepository } from './infrastructure/kb/GithubKbRepository.js';
import { GithubKbBackend } from './infrastructure/kb/GithubKbBackend.js';
import { LocalKbBackend } from './infrastructure/kb/LocalKbBackend.js';
import { DispatchingKbStore } from './infrastructure/kb/DispatchingKbStore.js';
import { DrizzleKbDocumentRepository } from './infrastructure/repositories/DrizzleKbDocumentRepository.js';
import { InitLocalKb } from './application/kb/InitLocalKb.js';
import { CheckRepoUsage } from './application/agent/CheckRepoUsage.js';
import { RequestRepoAccess } from './application/agent/RequestRepoAccess.js';
import { GetMyAccount } from './application/agent/GetMyAccount.js';
import { DeleteProject } from './application/project/DeleteProject.js';
import { SetProjectDispatcher } from './application/project/SetProjectDispatcher.js';
import { SetProjectMultiTaskWorker } from './application/project/SetProjectMultiTaskWorker.js';
import { ListDispatcherCandidates } from './application/project/ListDispatcherCandidates.js';
import { ListMyDispatchedProjects } from './application/agent/ListMyDispatchedProjects.js';
import { pickDefaultDispatcherUserId } from './application/project/pickDefaultDispatcher.js';
import { SetGitTokenDelegation } from './application/project/SetGitTokenDelegation.js';
import { GetDelegatedGitToken } from './application/project/GetDelegatedGitToken.js';
import { ListGitTokenAccessLog } from './application/project/ListGitTokenAccessLog.js';
import { DrizzleGitTokenDelegationRepository } from './infrastructure/repositories/DrizzleGitTokenDelegationRepository.js';
import { InMemoryRateLimiter } from './infrastructure/ratelimit/InMemoryRateLimiter.js';
import { InitKbRepo } from './application/kb/InitKbRepo.js';
import { ConnectKbRepo } from './application/kb/ConnectKbRepo.js';
import { DisconnectKb } from './application/kb/DisconnectKb.js';
import { ListKbDocuments } from './application/kb/ListKbDocuments.js';
import { GetKbDocument } from './application/kb/GetKbDocument.js';
import { WriteKbDocument } from './application/kb/WriteKbDocument.js';
import { DeleteKbDocument } from './application/kb/DeleteKbDocument.js';
import { BulkCreateCredential } from './application/kb/BulkCreateCredential.js';
import { DrizzleTaskRepository } from './infrastructure/repositories/DrizzleTaskRepository.js';
import { DrizzleTaskCommitRepository } from './infrastructure/repositories/DrizzleTaskCommitRepository.js';
import { DrizzleTaskAttachmentRepository } from './infrastructure/repositories/DrizzleTaskAttachmentRepository.js';
import { DrizzleTaskCommentRepository } from './infrastructure/repositories/DrizzleTaskCommentRepository.js';
import { DrizzleTaskDelegationRepository } from './infrastructure/repositories/DrizzleTaskDelegationRepository.js';
import { AcceptTaskDelegation } from './application/task/AcceptTaskDelegation.js';
import { DeclineTaskDelegation } from './application/task/DeclineTaskDelegation.js';
import { WithdrawTaskDelegation } from './application/task/WithdrawTaskDelegation.js';
import { ListMyPendingDelegations } from './application/task/ListMyPendingDelegations.js';
import { ListTasksAssignedToMe } from './application/task/ListTasksAssignedToMe.js';
import { AssignInboxTaskToProject } from './application/task/AssignInboxTaskToProject.js';
import { DelegateExistingTask } from './application/task/DelegateExistingTask.js';
import { FileSystemAttachmentStorage } from './infrastructure/storage/FileSystemAttachmentStorage.js';
import { DrizzleAgentTokenRepository } from './infrastructure/repositories/DrizzleAgentTokenRepository.js';
import { DrizzleAiPromptJobRepository } from './infrastructure/repositories/DrizzleAiPromptJobRepository.js';
import { DrizzleUsageLedgerRepository } from './infrastructure/repositories/DrizzleUsageLedgerRepository.js';
import { RecordUsage } from './application/usage/RecordUsage.js';
import { GetUserUsage } from './application/usage/GetUserUsage.js';
import { BuyPlan } from './application/usage/BuyPlan.js';
import { CheckBudget } from './application/usage/CheckBudget.js';
import { CheckDispatchAllowed } from './application/usage/CheckDispatchAllowed.js';
import type { PlanMonthlyOverride } from './domain/usage/Plan.js';
import { EnqueueAiPromptJob } from './application/ai-prompt/EnqueueAiPromptJob.js';
import { WaitForAiPromptJob } from './application/ai-prompt/WaitForAiPromptJob.js';
import { ListPendingAiPromptJobs } from './application/ai-prompt/ListPendingAiPromptJobs.js';
import { ClaimAiPromptJob } from './application/ai-prompt/ClaimAiPromptJob.js';
import { CompleteAiPromptJob } from './application/ai-prompt/CompleteAiPromptJob.js';
import { GetAiPromptKbBundle } from './application/ai-prompt/GetAiPromptKbBundle.js';
import { AiPromptJobCleanup } from './application/ai-prompt/AiPromptJobCleanup.js';
import { resolveDefaultAiDispatcher } from './application/ai-prompt/resolveDefaultAiDispatcher.js';
import { DrizzleMonitoringAnalysisJobRepository } from './infrastructure/repositories/DrizzleMonitoringAnalysisJobRepository.js';
import { EnqueueMonitoringAnalysisJob } from './application/monitoring-analysis/EnqueueMonitoringAnalysisJob.js';
import { WaitForMonitoringAnalysisJob } from './application/monitoring-analysis/WaitForMonitoringAnalysisJob.js';
import { ListServerAnalysisHistory } from './application/monitoring-analysis/ListServerAnalysisHistory.js';
import { ListPendingMonitoringAnalysisJobs } from './application/monitoring-analysis/ListPendingMonitoringAnalysisJobs.js';
import { ClaimMonitoringAnalysisJob } from './application/monitoring-analysis/ClaimMonitoringAnalysisJob.js';
import { CompleteMonitoringAnalysisJob } from './application/monitoring-analysis/CompleteMonitoringAnalysisJob.js';
import { MonitoringAnalysisJobCleanup } from './application/monitoring-analysis/MonitoringAnalysisJobCleanup.js';
import { DrizzleCommitSyncJobRepository } from './infrastructure/repositories/DrizzleCommitSyncJobRepository.js';
import { EnqueueCommitSyncJob } from './application/commit-sync/EnqueueCommitSyncJob.js';
import { ListPendingCommitSyncJobs } from './application/commit-sync/ListPendingCommitSyncJobs.js';
import { ClaimCommitSyncJob } from './application/commit-sync/ClaimCommitSyncJob.js';
import { CompleteCommitSyncJob } from './application/commit-sync/CompleteCommitSyncJob.js';
import { CommitSyncJobCleanup } from './application/commit-sync/CommitSyncJobCleanup.js';
import { CommitSyncScheduler } from './infrastructure/scheduler/CommitSyncScheduler.js';
import { DrizzleAutomationRepository } from './infrastructure/repositories/DrizzleAutomationRepository.js';
import { GetAutomationConfig } from './application/automation/GetAutomationConfig.js';
import { SaveAutomationConfig } from './application/automation/SaveAutomationConfig.js';
import { GetAutomationForDispatcher } from './application/automation/GetAutomationForDispatcher.js';
import { RecordAutomationTask } from './application/automation/RecordAutomationTask.js';
import { Sha256AgentTokenHasher } from './infrastructure/crypto/Sha256AgentTokenHasher.js';
import { CreateAgentToken } from './application/agent/CreateAgentToken.js';
import { ListAgentTokens } from './application/agent/ListAgentTokens.js';
import { RevokeAgentToken } from './application/agent/RevokeAgentToken.js';
import { AuthenticateAgentToken } from './application/agent/AuthenticateAgentToken.js';
import { GetAgentCredential } from './application/agent/GetAgentCredential.js';
import { GetAgentTask } from './application/agent/GetAgentTask.js';
import { CreateAgentCredential } from './application/agent/CreateAgentCredential.js';
import { InMemoryAgentDeviceCodeStore } from './application/agent/AgentDeviceCodeStore.js';
import { RequestAgentDeviceCode } from './application/agent/RequestAgentDeviceCode.js';
import { ApproveAgentDeviceCode } from './application/agent/ApproveAgentDeviceCode.js';
import { PollAgentDeviceToken } from './application/agent/PollAgentDeviceToken.js';
import { GetAgentDeviceCodeInfo } from './application/agent/GetAgentDeviceCodeInfo.js';
import { randomBytes } from 'node:crypto';
import { ListTasks } from './application/task/ListTasks.js';
import { ExportTasksDigest } from './application/task/ExportTasksDigest.js';
import { DrizzleDigestSettingsRepository } from './infrastructure/repositories/DrizzleDigestSettingsRepository.js';
import { GetDigestSettings } from './application/digest/GetDigestSettings.js';
import { SaveDigestSettings } from './application/digest/SaveDigestSettings.js';
import { SendDailyDigest } from './application/digest/SendDailyDigest.js';
import { TriggerDailyDigestNow } from './application/digest/TriggerDailyDigestNow.js';
import { DailyDigestScheduler } from './infrastructure/scheduler/DailyDigestScheduler.js';
import { SearchTasks } from './application/task/SearchTasks.js';
import { DrizzleTaskSearchRepository } from './infrastructure/repositories/DrizzleTaskSearchRepository.js';
import { CreateTask } from './application/task/CreateTask.js';
import { UpdateTask } from './application/task/UpdateTask.js';
import { DrizzleTaskVersionRepository } from './infrastructure/repositories/DrizzleTaskVersionRepository.js';
import { TaskVersionRecorder } from './application/task/TaskVersionRecorder.js';
import { GetTaskVersions } from './application/task/GetTaskVersions.js';
import { RestoreTaskVersion } from './application/task/RestoreTaskVersion.js';
import { MoveTask } from './application/task/MoveTask.js';
import { DrizzleEmailActionTokenRepository } from './infrastructure/repositories/DrizzleEmailActionTokenRepository.js';
import { CreateEmailActionToken } from './application/email-action/CreateEmailActionToken.js';
import { EmailActionService } from './application/email-action/EmailActionService.js';
import { DeleteTask } from './application/task/DeleteTask.js';
import { LinkCommit } from './application/task/LinkCommit.js';
import { UnlinkCommit } from './application/task/UnlinkCommit.js';
import { ListTaskCommits } from './application/task/ListTaskCommits.js';
import { SyncTaskCommits } from './application/task/SyncTaskCommits.js';
import { UploadTaskAttachment } from './application/task/UploadTaskAttachment.js';
import { DeleteTaskAttachment } from './application/task/DeleteTaskAttachment.js';
import { ListTaskAttachments } from './application/task/ListTaskAttachments.js';
import { GetTaskAttachment } from './application/task/GetTaskAttachment.js';
import { ListTaskComments } from './application/task/ListTaskComments.js';
import { ListTaskCommentsForAgent } from './application/task/ListTaskCommentsForAgent.js';
import { MaybeReopenForClarification } from './application/task/MaybeReopenForClarification.js';
import { HttpTelegramClient } from './infrastructure/telegram/HttpTelegramClient.js';
import { DrizzleTelegramOutboundRepository } from './infrastructure/repositories/DrizzleTelegramOutboundRepository.js';
import { DrizzleTelegramRalphQuestionRepository } from './infrastructure/repositories/DrizzleTelegramRalphQuestionRepository.js';
import { DrizzleTelegramTaskDraftRepository } from './infrastructure/repositories/DrizzleTelegramTaskDraftRepository.js';
import { DrizzleTelegramTaskMessageRepository } from './infrastructure/repositories/DrizzleTelegramTaskMessageRepository.js';
import { TelegramComposerService } from './application/telegram/composer/TelegramComposerService.js';
import { ConnectTelegramAccount } from './application/telegram/ConnectTelegramAccount.js';
import { GetTelegramStatus } from './application/telegram/GetTelegramStatus.js';
import { SendAgentTelegramNotification } from './application/telegram/SendAgentTelegramNotification.js';
import { HandleTelegramWebhook } from './application/telegram/HandleTelegramWebhook.js';
import { BroadcastTelegramNotificationByTask } from './application/telegram/BroadcastTelegramNotificationByTask.js';
import { TelegramPoller } from './application/telegram/TelegramPoller.js';
import { CreateTaskComment } from './application/task/CreateTaskComment.js';
import { UpdateTaskComment } from './application/task/UpdateTaskComment.js';
import { DeleteTaskComment } from './application/task/DeleteTaskComment.js';
import { RequestRalphCancel } from './application/task/RequestRalphCancel.js';
import { RevokeRalphCancel } from './application/task/RevokeRalphCancel.js';
import { AckRalphCancel } from './application/task/AckRalphCancel.js';
import { ListNotifications } from './application/notifications/ListNotifications.js';
import { CountUnreadNotifications } from './application/notifications/CountUnreadNotifications.js';
import { MarkNotificationRead } from './application/notifications/MarkNotificationRead.js';
import { MarkAllNotificationsRead } from './application/notifications/MarkAllNotificationsRead.js';
import { DrizzleSecretsRepository } from './infrastructure/repositories/DrizzleSecretsRepository.js';
import { PutSecret } from './application/secrets/PutSecret.js';
import { GetSecret } from './application/secrets/GetSecret.js';
import { DeleteSecret } from './application/secrets/DeleteSecret.js';
import { ListSecretKeys } from './application/secrets/ListSecretKeys.js';
import { DrizzleAdminRepository } from './infrastructure/repositories/DrizzleAdminRepository.js';
import { ListAllProjects } from './application/admin/ListAllProjects.js';
import { ListAllUsers } from './application/admin/ListAllUsers.js';
import { ListUserProjectsWithDispatcher } from './application/admin/ListUserProjectsWithDispatcher.js';
import { ListUserProjectsWithFavorites } from './application/admin/ListUserProjectsWithFavorites.js';
import { SetUserProjectFavorite } from './application/admin/SetUserProjectFavorite.js';
import { UpdateUserAsAdmin } from './application/admin/UpdateUserAsAdmin.js';
import { DrizzleEmployeeRepository } from './infrastructure/repositories/DrizzleEmployeeRepository.js';
import { DrizzleProjectFinanceRepository } from './infrastructure/repositories/DrizzleProjectFinanceRepository.js';
import { ManageEmployees } from './application/finance/ManageEmployees.js';
import { ManageProjectFinance } from './application/finance/ManageProjectFinance.js';
import { GetProjectFinance } from './application/finance/GetProjectFinance.js';
import { DrizzleServerRepository } from './infrastructure/repositories/DrizzleServerRepository.js';
import { DrizzleSnapshotRepository } from './infrastructure/repositories/DrizzleSnapshotRepository.js';
import { DrizzleMonitoringAlertRepository } from './infrastructure/repositories/DrizzleMonitoringAlertRepository.js';
import { ShellLocalServerCollector } from './infrastructure/monitoring/ShellLocalServerCollector.js';
import { MysqlDbHealthProbe } from './infrastructure/monitoring/MysqlDbHealthProbe.js';
import { DrizzleMonitoringAlertRuleRepository } from './infrastructure/repositories/DrizzleMonitoringAlertRuleRepository.js';
import { ManageAlertRules } from './application/monitoring/ManageAlertRules.js';
import { GetMonitoringOverview } from './application/monitoring/GetMonitoringOverview.js';
import { GetAlertCenter } from './application/monitoring/GetAlertCenter.js';
import { AlertNotificationDispatcher } from './application/monitoring/AlertNotificationDispatcher.js';
import { EvaluateAlerts } from './application/monitoring/EvaluateAlerts.js';
import { CollectLocalSnapshot } from './application/monitoring/CollectLocalSnapshot.js';
import { IngestAgentSnapshot } from './application/monitoring/IngestAgentSnapshot.js';
import { ListServers } from './application/monitoring/ListServers.js';
import { ManageServers } from './application/monitoring/ManageServers.js';
import { MonitoringQueries } from './application/monitoring/MonitoringQueries.js';
import { ListMonitoredServers } from './application/monitoring/ListMonitoredServers.js';
import { MonitoringKbSnapshotWriter } from './application/monitoring/MonitoringKbSnapshotWriter.js';
import type { ServerSnapshot } from './domain/monitoring/ServerSnapshot.js';
import { createApp } from './presentation/http.js';
import { config, sessionTtlMs } from './presentation/config.js';

const passwordHasher = new Argon2PasswordHasher();
const now = (): Date => new Date();

const userRepo = new DrizzleUserRepository(db);
const sessionRepo = new DrizzleSessionRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const projectMemberRepo = new DrizzleProjectMemberRepository(db);
const projectInviteRepo = new DrizzleProjectInviteRepository(db);
const recentTaskViewRepo = new DrizzleRecentTaskViewRepository(db);
const projectViewRepo = new DrizzleProjectViewRepository(db);

// === Пространства (workspaces) ===
const workspaceRepo = new DrizzleWorkspaceRepository(db);
const workspaceService = new WorkspaceService({
  repo: workspaceRepo,
  projects: projectRepo,
  projectMembers: projectMemberRepo,
  users: userRepo,
  idGen: idGenerator,
});
// Активное пространство юзера (current ?? первое доступное). Кидает если пространств нет —
// для create-проекта/inbox это инвариант (после миграции у каждого есть личное пространство).
const resolveWorkspaceId = async (userId: string): Promise<string> => {
  const current = await workspaceRepo.getCurrentWorkspaceId(userId);
  if (current) return current;
  const another = await workspaceRepo.findAnotherForUser(userId, '');
  if (another) return another;
  throw new Error(`User ${userId} has no workspace`);
};
// Активное пространство для листинга проектов: id + kind (null = нет пространств → пустой список).
// kind решает охват: 'default' → ВСЕ мои проекты (хаб), 'team' → срез по workspace_id (см. ListProjects).
const resolveActiveWorkspace = async (
  userId: string,
): Promise<{ id: string; kind: WorkspaceKind } | null> => {
  const current = await workspaceRepo.getCurrentWorkspaceId(userId);
  const id = current ?? (await workspaceRepo.findAnotherForUser(userId, ''));
  if (!id) return null;
  const ws = await workspaceRepo.getById(id);
  return ws ? { id: ws.id, kind: ws.kind } : null;
};
// Создаёт пространство по умолчанию новому юзеру + делает активным (для Register).
// Имя — «Пространство <имя аккаунта>». Это его дефолт-хаб (kind='default'): один на юзера,
// неудаляем, агрегирует все его проекты.
const createDefaultWorkspace = async (userId: string, displayName: string): Promise<void> => {
  await workspaceService.create(userId, {
    name: `Пространство ${displayName}`,
    icon: null,
    kind: 'default',
  });
};
// Синк участников дефолт-хаба владельца с участниками его проектов (для общего чата).
// Дёргается best-effort из invite/accept/remove use-cases.
const hubMembershipSync = new HubMembershipSync({
  projects: projectRepo,
  members: projectMemberRepo,
  workspaces: workspaceRepo,
});
// Deep-link авто-switch: открыли проект → делаем его пространство активным.
// В новой модели в ЧУЖОЙ дефолт-хаб не переключаемся (он скрыт из свитчера, см. listForUser) —
// проект и так виден в собственном дефолт-хабе юзера (агрегация). В этом случае переключаем
// на СВОЙ дефолт, чтобы проект гарантированно отображался. Команды и свой хаб — как раньше.
const setActiveWorkspaceForProject = async (userId: string, projectId: string): Promise<void> => {
  const wsId = await projectRepo.getWorkspaceId(projectId);
  if (!wsId) return;
  const ws = await workspaceRepo.getById(wsId);
  if (!ws) return;
  const current = await workspaceRepo.getCurrentWorkspaceId(userId);
  if (ws.kind === 'default' && ws.ownerUserId !== userId) {
    const ownHub = await workspaceRepo.findDefaultForOwner(userId);
    if (ownHub && current !== ownHub) await workspaceRepo.setCurrentWorkspace(userId, ownHub);
    return;
  }
  if (current === wsId) return;
  const membership = await workspaceRepo.getMembership(wsId, userId);
  if (membership) await workspaceRepo.setCurrentWorkspace(userId, wsId);
};
// Real-time-доставка: хаб + декоратор поверх Drizzle-репозитория. Любое создание
// уведомления автоматически push'ится подписчикам SSE.
const notificationHub = new NotificationHub();
const notificationRepo = new PublishingNotificationRepository(
  new DrizzleNotificationRepository(db),
  notificationHub,
);

// === Лента действий (activity feed) ===
const activityRepo = new DrizzleActivityRepository(db);
// best-effort рекордер: инжектится в мутирующие use-case'ы (создание/статус/удаление задач,
// комментарии, создание проекта, изменения участников). Резолвит пространство по проекту.
const activityRecorder = new ActivityRecorder({
  activity: activityRepo,
  resolveWorkspaceId: (projectId) => projectRepo.getWorkspaceId(projectId),
  idGen: idGenerator,
});
const getActivityFeed = new GetActivityFeed({
  activity: activityRepo,
  notifications: notificationRepo,
});
// GC: чистим события старше 30 дней (на старте + раз в сутки).
const ACTIVITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const sweepActivity = (): void => {
  void activityRepo.deleteOlderThan(new Date(Date.now() - ACTIVITY_TTL_MS)).catch(() => {});
};
sweepActivity();
setInterval(sweepActivity, 24 * 60 * 60 * 1000).unref();
// Real-time-события (task/project changed) для live-обновления UI без перезагрузки.
// Транслируются всем участникам проекта по тому же SSE-коннекту, что и уведомления.
const realtimeHub = new RealtimeHub();
const projectEventBroadcaster = new ProjectEventBroadcaster({
  members: projectMemberRepo,
  publisher: realtimeHub,
});
// Best-effort: ошибка резолва участников не должна влиять на основной запрос.
const notifyTaskChanged = (projectId: string): void => {
  void projectEventBroadcaster.broadcast(projectId, 'task_changed').catch(() => {});
};
const notifyProjectChanged = (projectId: string): void => {
  void projectEventBroadcaster.broadcast(projectId, 'project_changed').catch(() => {});
};
// SSE comment_added — для Ralph-диспетчера (мгновенная реакция вместо polling'а).
const notifyCommentAdded = (
  projectId: string,
  taskId: string,
  commentId: string,
  ownerUserId: string,
  actorKind?: 'user' | 'agent' | 'system',
  agentName?: string | null,
): void => {
  void projectEventBroadcaster
    .broadcastCommentAdded(projectId, taskId, commentId, ownerUserId, actorKind, agentName)
    .catch(() => {});
};
// SSE task_status_changed — move и авто-возврат awaiting_clarification → in_progress.
const notifyStatusChanged = (
  projectId: string,
  taskId: string,
  oldStatus: string,
  newStatus: string,
  actorUserId: string,
): void => {
  void projectEventBroadcaster
    .broadcastStatusChanged(projectId, taskId, oldStatus, newStatus, actorUserId)
    .catch(() => {});
};
const githubTokenRepo = new DrizzleGithubTokenRepository(db);

// Email: SMTP если задан SMTP_HOST, иначе логирующая заглушка (dev без почтовика).
const emailSender: EmailSender = process.env['SMTP_HOST']
  ? new SmtpEmailSender({
      host: process.env['SMTP_HOST'],
      port: Number(process.env['SMTP_PORT'] ?? 587),
      user: process.env['SMTP_USER'] ?? '',
      password: process.env['SMTP_PASSWORD'] ?? '',
      from: process.env['SMTP_FROM'] ?? process.env['SMTP_USER'] ?? 'no-reply@projectsflow.ru',
      secure: Number(process.env['SMTP_PORT'] ?? 587) === 465,
      // Строгая проверка cert по умолчанию; SMTP_TLS_REJECT_UNAUTHORIZED=false —
      // для self-hosted MTA с самоподписанным сертификатом.
      rejectUnauthorized: process.env['SMTP_TLS_REJECT_UNAUTHORIZED'] !== 'false',
    })
  : new LoggingEmailSender();
const appBaseUrl =
  process.env['APP_URL'] ?? process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173';

const githubApi = new FetchGithubApiClient(config.github.clientId);
const deviceFlowStore = new DeviceFlowStore();
const kbRepo = new GithubKbRepository(githubApi);
const kbDocumentRepo = new DrizzleKbDocumentRepository(db);

const secretsRepo = new DrizzleSecretsRepository(db);
const taskRepo = new DrizzleTaskRepository(db);
const taskVersionRepo = new DrizzleTaskVersionRepository(db);
const taskVersionRecorder = new TaskVersionRecorder({ versions: taskVersionRepo, idGen: idGenerator });
const taskCommitRepo = new DrizzleTaskCommitRepository(db);
const taskAttachmentRepo = new DrizzleTaskAttachmentRepository(db);
const taskCommentRepo = new DrizzleTaskCommentRepository(db);
const taskDelegationRepo = new DrizzleTaskDelegationRepository(db);
const digestSettingsRepo = new DrizzleDigestSettingsRepository(db);
const agentTokenRepo = new DrizzleAgentTokenRepository(db);
const aiPromptJobRepo = new DrizzleAiPromptJobRepository(db);
// Метеринг расхода ИИ (db/082): единый ledger + хаб RecordUsage, который зовут все
// completion-пути (live / ai_prompt / monitoring / commit_sync). См. план gleaming-munching-locket.
const usageLedgerRepo = new DrizzleUsageLedgerRepository(db);
const recordUsage = new RecordUsage({ ledger: usageLedgerRepo, idGen: idGenerator });
// Env-оверрайд МЕСЯЧНОГО лимита плана в USD (для тестов/тюнинга без деплоя). Пусто →
// PLAN_MONTHLY_USD ($50 Prime / $100 VIP). Недельный = месяц/4, 5ч = недельный×0.4.
// Напр. USAGE_PRIME_MONTHLY_USD=2 → блок Prime ловится в тесте почти сразу.
const usageCapsOverride = ((): PlanMonthlyOverride | undefined => {
  const num = (name: string): number | undefined => {
    const raw = process.env[name];
    if (!raw) return undefined;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const prime = num('USAGE_PRIME_MONTHLY_USD');
  const vip = num('USAGE_VIP_MONTHLY_USD');
  if (prime === undefined && vip === undefined) return undefined;
  return {
    ...(prime !== undefined ? { prime } : {}),
    ...(vip !== undefined ? { vip } : {}),
  };
})();
const getUserUsage = new GetUserUsage({
  ledger: usageLedgerRepo,
  users: userRepo,
  now,
  capsOverride: usageCapsOverride,
});
const buyPlan = new BuyPlan({ users: userRepo, now });
const checkBudget = new CheckBudget({ getUserUsage });
const automationRepo = new DrizzleAutomationRepository(db);
const taskSearchRepo = new DrizzleTaskSearchRepository(db);
const projectJoinRequestRepo = new DrizzleProjectJoinRequestRepository(db);
const adminRepo = new DrizzleAdminRepository(db);
const employeeRepo = new DrizzleEmployeeRepository(db);
const projectFinanceRepo = new DrizzleProjectFinanceRepository(db);

const gitTokenDelegationRepo = new DrizzleGitTokenDelegationRepository(db, idGenerator);

// KB-store: единый фасад, выбирающий github↔local-бэкенд по project.kbKind.
// v0.16+: GithubKbBackend получает `delegations`/`projects`/`users` для
// fallback'а на делегированный токен в `resolveEffectiveGithubToken`.
const kbStore = new DispatchingKbStore({
  github: new GithubKbBackend({
    kb: kbRepo,
    tokens: githubTokenRepo,
    projects: projectRepo,
    delegations: gitTokenDelegationRepo,
    users: userRepo,
  }),
  local: new LocalKbBackend({ docs: kbDocumentRepo, idGen: idGenerator }),
});

// In-memory rate-limiter для agent repo-usage / repo-access-requests.
const agentRateLimiter = new InMemoryRateLimiter();
setInterval(() => agentRateLimiter.pruneExpired(), 10 * 60 * 1000).unref();

// Политика «авто-дефолт Ralph-диспетчера для новых проектов»: первый admin
// с активным agent-токеном. Если такого нет — null, проект остаётся в ручном
// режиме. Используется в CreateProject (web + agent flow).
const resolveDefaultDispatcher = (): Promise<string | null> =>
  pickDefaultDispatcherUserId(userRepo, agentTokenRepo);

// AI prompt-improvement: дефолтный диспетчер для Inbox-задач (без projectId).
// Логика — в resolveDefaultAiDispatcher: явный AI_PROMPT_DEFAULT_DISPATCHER_EMAIL (если
// у юзера есть активный токен) → иначе фоллбэк на первого админа с активным токеном
// (дежурный Ralph-диспетчер). Фоллбэк = «работает из коробки» даже без env.
// Кешируем на 60 сек: не лазим в БД на каждый enqueue, но подхватываем revoke токенов
// и переименования email'а.
const aiPromptDefaultDispatcherEmail = (
  process.env['AI_PROMPT_DEFAULT_DISPATCHER_EMAIL'] ?? ''
).trim().toLowerCase();
let aiPromptDispatcherCache: { userId: string | null; cachedAt: number } | null = null;
const AI_PROMPT_DISPATCHER_CACHE_TTL_MS = 60 * 1000;
const resolveDefaultAiDispatcherUserId = async (): Promise<string | null> => {
  const now = Date.now();
  if (aiPromptDispatcherCache && now - aiPromptDispatcherCache.cachedAt < AI_PROMPT_DISPATCHER_CACHE_TTL_MS) {
    return aiPromptDispatcherCache.userId;
  }
  const userId = await resolveDefaultAiDispatcher({
    email: aiPromptDefaultDispatcherEmail,
    users: userRepo,
    agentTokens: agentTokenRepo,
  });
  aiPromptDispatcherCache = { userId, cachedAt: now };
  return userId;
};

// Periodic cleanup для ai_prompt_jobs (каждые 60 сек). Лог только когда что-то сделано —
// чтобы не засорять stdout.
const aiPromptJobCleanup = new AiPromptJobCleanup({ aiPromptJobs: aiPromptJobRepo });
setInterval(
  () => {
    void aiPromptJobCleanup
      .runOnce(new Date())
      .then((r) => {
        if (r.cancelled > 0 || r.deleted > 0) {
          console.log(
            `[ai-prompt-cleanup] cancelled=${r.cancelled} deleted=${r.deleted}`,
          );
        }
      })
      .catch((err) => console.warn('[ai-prompt-cleanup] failed:', err));
  },
  60 * 1000,
).unref();

// Секрет для непрозрачного requestTarget (HMAC). Отдельный env → fallback на vault-ключ.
// ВАЖНО: в prod refuse-to-boot если оба env не заданы — иначе fallback на
// захардкоженый 'dev-repo-access-secret' (виден в исходниках) позволил бы любому
// форджить requestTarget'ы и DDOS'ить notifications.
const envRepoAccessSecret = process.env['REPO_ACCESS_HMAC_SECRET'] ?? process.env['SECRETS_MASTER_KEY'];
if (!envRepoAccessSecret && process.env['NODE_ENV'] === 'production') {
  throw new Error(
    'REPO_ACCESS_HMAC_SECRET (or SECRETS_MASTER_KEY) must be set in production — refusing to start with the dev fallback.',
  );
}
const repoAccessSecret = envRepoAccessSecret ?? 'dev-repo-access-secret';

// Рассылка email-оповещений команде по активности проекта (с учётом пер-участниковых
// настроек и источника team/mcp). Используется роутами fire-and-forget.
const projectNotifier = new ProjectNotificationService({
  members: projectMemberRepo,
  projects: projectRepo,
  tasks: taskRepo,
  email: emailSender,
  appUrl: appBaseUrl,
});

// ===== Telegram multi-user notifications (Phase 1) =====
// Конфиг: см. .env / spec multi-user-telegram-notifications.md. Все поля опциональны —
// без token'а сервис в graceful-режиме: GET /api/me/telegram отвечает connected=false,
// connect-попытки фейлятся при verify (нечем подписывать HMAC), агентский send
// возвращает 'error: no token'. Webhook не регистрируется автоматически.
const telegramBotToken = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
const telegramBotUsername = process.env['TELEGRAM_BOT_USERNAME'] ?? null;
const telegramWebhookSecret = process.env['TELEGRAM_WEBHOOK_SECRET'] ?? null;
const telegramWebhookUrl = process.env['TELEGRAM_WEBHOOK_URL'] ?? null;
// TELEGRAM_API_BASE_URL — опциональный relay (например, CF-worker), если хостинг не
// маршрутизирует api.telegram.org (типично RU-провайдеры: часть подсетей даёт ETIMEDOUT).
// Без env — прямой канал на api.telegram.org.
const telegramApiBaseUrl =
  process.env['TELEGRAM_API_BASE_URL'] ?? 'https://api.telegram.org';
// TELEGRAM_HTTP_PROXY — HTTP(S)-proxy URL (стандарт http://user:pass@host:port) для
// всех исходящих к Telegram. Самый простой способ обойти провайдерскую блокировку.
const telegramHttpProxy = process.env['TELEGRAM_HTTP_PROXY'] || undefined;

const telegramClient = new HttpTelegramClient(
  telegramBotToken,
  telegramApiBaseUrl,
  telegramHttpProxy,
);
const telegramOutboundRepo = new DrizzleTelegramOutboundRepository(db);
const telegramRalphQuestionRepo = new DrizzleTelegramRalphQuestionRepository(db);

const connectTelegramAccount = new ConnectTelegramAccount({
  users: userRepo,
  botToken: telegramBotToken,
  maxAuthAgeSeconds: 86_400,
});
const getTelegramStatus = new GetTelegramStatus({
  users: userRepo,
  botUsername: telegramBotUsername,
  // bot_id = часть токена до «:» (публичная). Нужен фронту для кастомной login-кнопки.
  botId: telegramBotToken ? (telegramBotToken.split(':')[0] ?? null) : null,
});
// Маппинг agent-kind → user pref-toggle. Неизвестные kinds шлются без pref-чека.
// v2: добавлены ralph_answer_accepted/comment_on_my_task/task_blocked + task_done
// перемаплен на statusChange (а не taskDone) по spec multi-user-telegram-...-v2-delta.
const TG_KIND_TO_PREF = {
  comment: 'commentOnMyTask',
  comment_on_my_task: 'commentOnMyTask',
  mention: 'mention',
  status_change: 'statusChange',
  task_done: 'statusChange',
  task_blocked: 'statusChange',
  ralph_question: 'ralphQuestion',
  ralph_question_reminder: 'ralphQuestion',
  ralph_answer: 'ralphAnswer',
  ralph_answer_accepted: 'ralphAnswer',
  server_alert: 'serverAlert',
} as const;
// Маппинг task-сообщений бота → задача (db/049). Общий экземпляр: сендеру нужен для
// reply→комментарий на задачных уведомлениях, конструктору/вебхуку — для тех же reply'ев.
const telegramTaskMessageRepo = new DrizzleTelegramTaskMessageRepository(db);
const sendAgentTelegramNotification = new SendAgentTelegramNotification({
  users: userRepo,
  client: telegramClient,
  outbound: telegramOutboundRepo,
  ralphQuestionMessages: telegramRalphQuestionRepo,
  taskMessages: telegramTaskMessageRepo,
  tasks: taskRepo,
  idGen: idGenerator,
  kindToPref: TG_KIND_TO_PREF,
});

// --- Чат-виджет: поддержка ---
// Обращения сохраняются в support_tickets и доставляются админам/руту in-app уведомлением
// (раздел «Администрирование» → вкладка «Поддержка»; бейдж у рута через SSE). Telegram-доставка
// отключена — UI поддержки больше не обещает ответ в Telegram.
const supportTicketRepo = new DrizzleSupportTicketRepository(db);
const submitSupportTicket = new SubmitSupportTicket({
  tickets: supportTicketRepo,
  users: userRepo,
  notifications: notificationRepo,
  idGen: idGenerator,
});
// CreateTaskComment + MaybeReopenForClarification используются и в HTTP-роутерах (см. ниже),
// и в HandleTelegramWebhook (reply→ralph-answer ветка). Один экземпляр на оба чтобы не
// дублировать конструкцию и не разъезжаться по поведению.
const createTaskCommentUseCase = new CreateTaskComment({
  projects: projectRepo,
  members: projectMemberRepo,
  tasks: taskRepo,
  comments: taskCommentRepo,
  notifications: notificationRepo,
  delegations: taskDelegationRepo,
  idGen: idGenerator,
  activityRecorder,
});
const maybeReopenForClarification = new MaybeReopenForClarification({ tasks: taskRepo });

// --- Telegram-конструктор задач (+проект текст @делегат) ---
// Свои репо для черновиков конструктора (db/048) и маппинга task-сообщений (db/049).
const telegramTaskDraftRepo = new DrizzleTelegramTaskDraftRepository(db);
// Конструктору нужны те же use-case'ы что и HTTP/agent-роутерам; они собираются инлайн
// внутри createApp(), а здесь нам нужны собственные экземпляры (use-case'ы stateless —
// дубль безопасен). Делим только репозитории.
// AI-перефраз сообщений бота в задачи (простой/быстрый compose pass-1). Те же use-case'ы
// переиспользуются HTTP-роутами ниже (см. createApp). Best-effort — если AI недоступен,
// конструктор откатывается на ручной флоу.
const enqueueAiPromptJob = new EnqueueAiPromptJob({
  projects: projectRepo,
  members: projectMemberRepo,
  aiPromptJobs: aiPromptJobRepo,
  listProjects: new ListProjects({ members: projectMemberRepo, resolveActiveWorkspace }),
  listKbDocuments: new ListKbDocuments({ projects: projectRepo, members: projectMemberRepo, kb: kbStore }),
  getKbDocument: new GetKbDocument({ projects: projectRepo, members: projectMemberRepo, kb: kbStore }),
  rateLimiter: agentRateLimiter,
  resolveDefaultDispatcherUserId: resolveDefaultAiDispatcherUserId,
});
const waitForAiPromptJob = new WaitForAiPromptJob({
  aiPromptJobs: aiPromptJobRepo,
  isAdmin: async (userId) => (await userRepo.getById(userId))?.isAdmin ?? false,
});
const telegramComposer = new TelegramComposerService({
  drafts: telegramTaskDraftRepo,
  taskMessages: telegramTaskMessageRepo,
  members: projectMemberRepo,
  projects: projectRepo,
  users: userRepo,
  createTask: new CreateTask({
    projects: projectRepo,
    members: projectMemberRepo,
    tasks: taskRepo,
    delegations: taskDelegationRepo,
    users: userRepo,
    notifications: notificationRepo,
    email: emailSender,
    idGen: idGenerator,
    appUrl: appBaseUrl,
    activityRecorder,
  }),
  getOrCreateInbox: new GetOrCreateInbox({
    repo: projectRepo,
    members: projectMemberRepo,
    idGen: idGenerator,
    resolveWorkspaceId,
  }),
  accept: new AcceptTaskDelegation({
    delegations: taskDelegationRepo,
    tasks: taskRepo,
    projects: projectRepo,
    members: projectMemberRepo,
    users: userRepo,
    notifications: notificationRepo,
    idGen: idGenerator,
  }),
  decline: new DeclineTaskDelegation({
    delegations: taskDelegationRepo,
    tasks: taskRepo,
    users: userRepo,
    notifications: notificationRepo,
    email: emailSender,
    idGen: idGenerator,
    appUrl: appBaseUrl,
  }),
  assignToProject: new AssignInboxTaskToProject({
    tasks: taskRepo,
    projects: projectRepo,
    members: projectMemberRepo,
    delegations: taskDelegationRepo,
    users: userRepo,
    notifications: notificationRepo,
    email: emailSender,
    idGen: idGenerator,
    appUrl: appBaseUrl,
  }),
  sendNotification: sendAgentTelegramNotification,
  client: telegramClient,
  idGen: idGenerator,
  shortIdGen: shortIdGenerator,
  appUrl: appBaseUrl,
  enqueueAiPromptJob,
  waitForAiPromptJob,
});
// v2: fan-out по taskId — грузит задачу/members и переиспользует sendAgentTelegramNotification
// per recipient (там уже все gates — link/started/prefs/dedup/audit).
const broadcastTelegramByTask = new BroadcastTelegramNotificationByTask({
  tasks: taskRepo,
  members: projectMemberRepo,
  send: sendAgentTelegramNotification,
});
// Журнал доставки уведомлений по комментарию + оркестратор (email + TG адресно).
// Единый источник «кто уведомлён» — питает меню ⋮ у комментария.
const commentNotificationLogRepo = new DrizzleCommentNotificationLogRepository(db);
const dispatchCommentNotifications = new DispatchCommentNotifications({
  members: projectMemberRepo,
  projects: projectRepo,
  tasks: taskRepo,
  email: emailSender,
  tgSend: sendAgentTelegramNotification,
  log: commentNotificationLogRepo,
  idGen: idGenerator,
  appUrl: appBaseUrl,
});
// Собирается после composer + dispatchCommentNotifications — зависит от обоих.
const handleTelegramWebhook = new HandleTelegramWebhook({
  users: userRepo,
  members: projectMemberRepo,
  tasks: taskRepo,
  client: telegramClient,
  appUrl: appBaseUrl,
  signingSecret: repoAccessSecret,
  botUsername: telegramBotUsername,
  ralphQuestionMessages: telegramRalphQuestionRepo,
  taskMessages: telegramTaskMessageRepo,
  createComment: createTaskCommentUseCase,
  // Инлайн «Завершить/Отменить» на задачных уведомлениях (nd:/nu: callback).
  moveTask: new MoveTask({
    projects: projectRepo,
    members: projectMemberRepo,
    tasks: taskRepo,
    delegations: taskDelegationRepo,
    activityRecorder,
  }),
  dispatchCommentNotifications,
  composer: telegramComposer,
  maybeReopenForClarification,
  notifyTaskChanged,
  notifyCommentAdded,
  notifyStatusChanged,
});
// Polling-fallback: для хостингов где inbound от Telegram блокируется (типично RU).
// Сам long-poll'ит getUpdates через тот же proxy.
const telegramPoller = new TelegramPoller({
  client: telegramClient,
  handler: handleTelegramWebhook,
});

// Admin-bypass: системный админ (users.is_admin) получает доступ ко всем проектам
// через requireProjectAccess. Кешировать не нужно — getById дешёвый, вызов на access-check.
configureAdminBypass(async (userId) => {
  const u = await userRepo.getById(userId);
  return u?.isAdmin ?? false;
});

// Каталог с binary-аттачами. В dev: ./uploads (рядом с кодом), в prod: задаём
// UPLOADS_DIR в .env (typically /var/www/.../uploads — снаружи tarball'а деплоя,
// чтобы файлы переживали релизы).
import { resolve as resolvePath } from 'node:path';
const uploadsDir = resolvePath(process.env['UPLOADS_DIR'] ?? 'uploads');
const attachmentStorage = new FileSystemAttachmentStorage(uploadsDir);
console.log(`[projectsflow] attachments dir: ${uploadsDir}`);

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024; // 100 MB. Любой тип файла (валидация = размер).
const MAX_COVER_BYTES = 20 * 1024 * 1024; // 20 MB. Обложка проекта — только картинки (jpg/png/webp/gif).

// --- file-sync (PF Desktop Companion, миграция db/044) ---
const syncBlobsDir = resolvePath(process.env['SYNC_BLOBS_DIR'] ?? 'sync-blobs');
const blobStorage = new FileSystemBlobStorage(syncBlobsDir);
const SYNC_MAX_BLOB_BYTES = Number(process.env['SYNC_MAX_BLOB_BYTES'] ?? 100 * 1024 * 1024); // 100 MB/файл
const SYNC_DRAFT_PIN_SECONDS = Number(process.env['SYNC_DRAFT_PIN_SECONDS'] ?? 6 * 60 * 60); // 6h
const SYNC_DRAFT_MAX_AGE_SECONDS = Number(process.env['SYNC_DRAFT_MAX_AGE_SECONDS'] ?? 24 * 60 * 60); // 24h
// Server-authoritative ignore-set (обе стороны тянут и сверяют hash). См. дизайн §5.
const SYNC_IGNORE_SET = [
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'bin',
  'obj',
  '.idea',
  '.vs',
  '.DS_Store',
  'Thumbs.db',
];
const fileSyncService = new FileSyncService({
  projects: projectRepo,
  members: projectMemberRepo,
  repo: new DrizzleFileSyncRepository(db),
  storage: blobStorage,
  idGen: idGenerator,
  now,
  serverIgnoreSet: SYNC_IGNORE_SET,
  draftPinTtlSeconds: SYNC_DRAFT_PIN_SECONDS,
  maxBlobBytes: SYNC_MAX_BLOB_BYTES,
});
console.log(`[projectsflow] sync blobs dir: ${syncBlobsDir}`);
// Periodic GC: abort stale draft-снепшоты + удалить осиротевшие непинованные блобы.
setInterval(
  () => {
    void fileSyncService
      .pruneExpired(SYNC_DRAFT_MAX_AGE_SECONDS, 500)
      .then((r) => {
        if (r.abortedDrafts > 0 || r.deletedBlobs > 0) {
          console.log(`[projectsflow] sync-gc: aborted ${r.abortedDrafts} drafts, deleted ${r.deletedBlobs} blobs`);
        }
      })
      .catch((e) => console.error('[projectsflow] sync-gc error:', e));
  },
  10 * 60 * 1000,
).unref();

// ===== LIVE-вкладка задачи (db/053): стрим действий Ralph-воркера =====
// Task-scoped firehose live-событий (только для открытых SSE-вкладок; НЕ per-user bus).
const liveEventHub = new LiveEventHub();
const liveService = new LiveService({
  repo: new DrizzleLiveRepository(db),
  access: { projects: projectRepo, members: projectMemberRepo },
  broadcaster: projectEventBroadcaster,
  liveEventHub,
  idGen: idGenerator,
  recordUsage,
  checkBudget,
  taskDelegations: taskDelegationRepo,
  tasks: taskRepo,
});
// Startup-sweep: зависшие running-сессии (процесс упал, finish не доехал) → timeout.
// Best-effort: ошибка не должна мешать старту сервера.
void liveService.sweepStaleRunning().catch(() => {});

// ===== Чат пространства (db/075): общий канал участников пространства =====
// Workspace-scoped firehose событий чата (только для открытых SSE-вкладок; НЕ per-user bus).
const chatEventHub = new ChatEventHub();
const workspaceEventBroadcaster = new WorkspaceEventBroadcaster({
  members: workspaceRepo,
  publisher: realtimeHub,
});
const chatService = new ChatService({
  repo: new DrizzleChatRepository(db),
  workspaces: workspaceRepo,
  chatEventHub,
  broadcaster: workspaceEventBroadcaster,
  mentions: new DispatchChatMentionNotifications({ notifications: notificationRepo, idGen: idGenerator }),
  idGen: idGenerator,
});

const agentTokenHasher = new Sha256AgentTokenHasher();
const agentDeviceCodeStore = new InMemoryAgentDeviceCodeStore();

// Periodic cleanup истёкших pending device-code'ов (10 min TTL → каждые 5 min достаточно).
// Если процесс рестартится — все pending'и теряются, что норм: юзер просто запросит новый.
setInterval(
  () => {
    const pruned = agentDeviceCodeStore.pruneExpired(new Date());
    if (pruned > 0) console.log(`[projectsflow] device-code: pruned ${pruned} expired`);
  },
  5 * 60 * 1000,
).unref();

// ===== Мониторинг серверов (миграции db/050-052) =====
const serverRepo = new DrizzleServerRepository(db);
const snapshotRepo = new DrizzleSnapshotRepository(db);
const monitoringAlertRepo = new DrizzleMonitoringAlertRepository(db);
const monitoringAlertRuleRepo = new DrizzleMonitoringAlertRuleRepository(db);
const localServerCollector = new ShellLocalServerCollector();
const alertNotificationDispatcher = new AlertNotificationDispatcher({
  notifications: notificationRepo,
  sendTelegram: sendAgentTelegramNotification,
  members: projectMemberRepo,
  email: emailSender,
  idGen: idGenerator,
  appUrl: appBaseUrl,
});
const evaluateAlerts = new EvaluateAlerts({
  alerts: monitoringAlertRepo,
  servers: serverRepo,
  snapshots: snapshotRepo,
  projects: projectRepo,
  notifier: alertNotificationDispatcher,
  rules: monitoringAlertRuleRepo,
  idGen: idGenerator,
  now,
  // Авто-анализ critical-алерта через диспетчера (db/063). enqueueMonitoringAnalysisJob
  // объявлен ниже — замыкание вызывается в рантайме (при алерте), не при инициализации.
  autoAnalyzeCriticalAlert: async (input) => {
    await enqueueMonitoringAnalysisJob.enqueueAuto(input);
  },
});
// Хук: после сохранения любого снимка (local-collect / agent-ingest) оцениваем алерты.
const onMonitoringSnapshotStored = (
  snapshot: ServerSnapshot,
  prev: ServerSnapshot | null,
): void => {
  void evaluateAlerts
    .onSnapshotStored(snapshot, prev)
    .catch((e) => console.warn('[monitoring] alert eval failed:', e));
  // Лёгкий realtime-сигнал участникам: страница «Мониторинг» перекрасит статус без polling'а.
  void projectEventBroadcaster
    .broadcastSnapshotStored(snapshot.projectId, snapshot.serverId, snapshot.status)
    .catch(() => {});
};
const collectLocalSnapshot = new CollectLocalSnapshot({
  servers: serverRepo,
  snapshots: snapshotRepo,
  collector: localServerCollector,
  idGen: idGenerator,
  now,
  dbHealthProbe: new MysqlDbHealthProbe(pool),
  onSnapshotStored: onMonitoringSnapshotStored,
});
const ingestAgentSnapshot = new IngestAgentSnapshot({
  projects: projectRepo,
  members: projectMemberRepo,
  servers: serverRepo,
  snapshots: snapshotRepo,
  idGen: idGenerator,
  now,
  onSnapshotStored: onMonitoringSnapshotStored,
});
const manageServers = new ManageServers({
  projects: projectRepo,
  members: projectMemberRepo,
  servers: serverRepo,
  idGen: idGenerator,
  collectLocal: collectLocalSnapshot,
  rateLimiter: agentRateLimiter,
});
const listServersUseCase = new ListServers({
  projects: projectRepo,
  members: projectMemberRepo,
  servers: serverRepo,
  snapshots: snapshotRepo,
});
const monitoringQueries = new MonitoringQueries({
  projects: projectRepo,
  members: projectMemberRepo,
  servers: serverRepo,
  snapshots: snapshotRepo,
  alerts: monitoringAlertRepo,
});
const manageAlertRules = new ManageAlertRules({
  projects: projectRepo,
  members: projectMemberRepo,
  rules: monitoringAlertRuleRepo,
});
const listMonitoredServers = new ListMonitoredServers({ servers: serverRepo });
const monitoringOverview = new GetMonitoringOverview({
  listProjects: new ListProjects({ members: projectMemberRepo, resolveActiveWorkspace }),
  servers: serverRepo,
  snapshots: snapshotRepo,
  alerts: monitoringAlertRepo,
});
const monitoringAlertCenter = new GetAlertCenter({
  listProjects: new ListProjects({ members: projectMemberRepo, resolveActiveWorkspace }),
  servers: serverRepo,
  alerts: monitoringAlertRepo,
});
// AI-анализ мониторинга через диспетчера (db/063) — зеркало ai_prompt_jobs.
const monitoringAnalysisJobRepo = new DrizzleMonitoringAnalysisJobRepository(db);
const enqueueMonitoringAnalysisJob = new EnqueueMonitoringAnalysisJob({
  projects: projectRepo,
  members: projectMemberRepo,
  servers: serverRepo,
  snapshots: snapshotRepo,
  alerts: monitoringAlertRepo,
  monitoringAnalysisJobs: monitoringAnalysisJobRepo,
  rateLimiter: agentRateLimiter,
});
const waitForMonitoringAnalysisJob = new WaitForMonitoringAnalysisJob({
  monitoringAnalysisJobs: monitoringAnalysisJobRepo,
  isAdmin: async (userId) => (await userRepo.getById(userId))?.isAdmin ?? false,
});
const listServerAnalysisHistory = new ListServerAnalysisHistory({
  projects: projectRepo,
  members: projectMemberRepo,
  servers: serverRepo,
  monitoringAnalysisJobs: monitoringAnalysisJobRepo,
});
const listPendingMonitoringAnalysisJobs = new ListPendingMonitoringAnalysisJobs({
  monitoringAnalysisJobs: monitoringAnalysisJobRepo,
});
const claimMonitoringAnalysisJob = new ClaimMonitoringAnalysisJob({
  monitoringAnalysisJobs: monitoringAnalysisJobRepo,
  checkBudget,
});
const completeMonitoringAnalysisJob = new CompleteMonitoringAnalysisJob({
  monitoringAnalysisJobs: monitoringAnalysisJobRepo,
  recordUsage,
});
// Housekeeping каждые 60 сек (зеркало ai-prompt cleanup).
const monitoringAnalysisJobCleanup = new MonitoringAnalysisJobCleanup({
  monitoringAnalysisJobs: monitoringAnalysisJobRepo,
});
setInterval(() => {
  void monitoringAnalysisJobCleanup
    .runOnce(new Date())
    .then((r) => {
      if (r.cancelled > 0 || r.deleted > 0) {
        console.log(`[monitoring-analysis-cleanup] cancelled=${r.cancelled} deleted=${r.deleted}`);
      }
    })
    .catch((err) => console.warn('[monitoring-analysis-cleanup] failed:', err));
}, 60 * 1000).unref();

// Ежедневная commit-sync (db/072): планировщик ставит job, диспетчер матчит коммиты с
// задачами, сервер двигает статусы по порогу. Зеркало monitoring_analysis_jobs.
const commitSyncJobRepo = new DrizzleCommitSyncJobRepository(db);
const enqueueCommitSyncJob = new EnqueueCommitSyncJob({
  projects: projectRepo,
  automation: automationRepo,
  tasks: taskRepo,
  listProjectCommits: new ListProjectCommits({
    projects: projectRepo,
    members: projectMemberRepo,
    tokens: githubTokenRepo,
    api: githubApi,
  }),
  commitSyncJobs: commitSyncJobRepo,
});
const listPendingCommitSyncJobs = new ListPendingCommitSyncJobs({
  commitSyncJobs: commitSyncJobRepo,
});
const claimCommitSyncJob = new ClaimCommitSyncJob({ commitSyncJobs: commitSyncJobRepo, checkBudget });
const completeCommitSyncJob = new CompleteCommitSyncJob({
  commitSyncJobs: commitSyncJobRepo,
  tasks: taskRepo,
  recordUsage,
  // Привязка совпавшего коммита к карточке (best-effort, сбой не валит move).
  linkCommit: new LinkCommit({
    projects: projectRepo,
    members: projectMemberRepo,
    tasks: taskRepo,
    taskCommits: taskCommitRepo,
    tokens: githubTokenRepo,
    api: githubApi,
    delegations: gitTokenDelegationRepo,
    users: userRepo,
  }),
});
const commitSyncJobCleanup = new CommitSyncJobCleanup({ commitSyncJobs: commitSyncJobRepo });
setInterval(() => {
  void commitSyncJobCleanup
    .runOnce(new Date())
    .then((r) => {
      if (r.cancelled > 0 || r.deleted > 0) {
        console.log(`[commit-sync-cleanup] cancelled=${r.cancelled} deleted=${r.deleted}`);
      }
    })
    .catch((err) => console.warn('[commit-sync-cleanup] failed:', err));
}, 60 * 1000).unref();

const monitoringKbSnapshotWriter = new MonitoringKbSnapshotWriter({
  servers: serverRepo,
  snapshots: snapshotRepo,
  alerts: monitoringAlertRepo,
  projects: projectRepo,
  kb: kbStore,
  writeKbDocument: new WriteKbDocument({
    projects: projectRepo,
    members: projectMemberRepo,
    kb: kbStore,
  }),
});

// Периодический local-collect: на win32-dev по умолчанию OFF (нет pm2/df), на linux-prod ON.
// MONITOR_LOCAL_COLLECT=on|off — явный override.
const monitoringLocalCollectEnabled =
  process.env['MONITOR_LOCAL_COLLECT'] === 'on' ||
  (process.platform !== 'win32' && process.env['MONITOR_LOCAL_COLLECT'] !== 'off');
if (monitoringLocalCollectEnabled) {
  // Тик каждые 30с; конкретный сервер собираем не чаще его collect_interval_seconds.
  const localCollectLast = new Map<string, number>();
  setInterval(() => {
    void (async () => {
      const servers = await serverRepo.listEnabledByKind('local');
      const nowMs = Date.now();
      for (const s of servers) {
        const last = localCollectLast.get(s.id) ?? 0;
        const intervalMs = Math.max(30, s.collectIntervalSeconds) * 1000;
        if (nowMs - last < intervalMs) continue;
        localCollectLast.set(s.id, nowMs);
        try {
          await collectLocalSnapshot.collect(s, { force: true });
        } catch (e) {
          console.warn('[monitoring] local collect failed for', s.id, e);
        }
      }
    })().catch((e) => console.warn('[monitoring] local collect loop error:', e));
  }, 30 * 1000).unref();
}
// Прунинг старых снимков (TTL 30 дней по умолчанию).
const SNAPSHOT_TTL_DAYS = Number(process.env['MONITOR_SNAPSHOT_TTL_DAYS'] ?? 30);
setInterval(
  () => {
    const cutoff = new Date(Date.now() - SNAPSHOT_TTL_DAYS * 86_400 * 1000);
    void snapshotRepo
      .pruneOlderThan(cutoff, 500)
      .then((n) => {
        if (n > 0) console.log(`[monitoring] pruned ${n} old snapshots`);
      })
      .catch((e) => console.warn('[monitoring] prune error:', e));
  },
  10 * 60 * 1000,
).unref();
// Staleness-sweep: сервер замолчал → snapshot_stale.
setInterval(
  () => {
    void evaluateAlerts
      .sweepStaleness()
      .catch((e) => console.warn('[monitoring] staleness sweep error:', e));
  },
  5 * 60 * 1000,
).unref();
// Anomaly-sweep: ползущая деградация метрик (baseline + σ). Реже staleness — нужна история.
setInterval(
  () => {
    void evaluateAlerts
      .sweepAnomalies()
      .catch((e) => console.warn('[monitoring] anomaly sweep error:', e));
  },
  10 * 60 * 1000,
).unref();
// KB-снимки (markdown, только метрики). MONITOR_KB_SNAPSHOTS=off — выключить.
if (process.env['MONITOR_KB_SNAPSHOTS'] !== 'off') {
  setInterval(
    () => {
      void monitoringKbSnapshotWriter
        .writeForAll()
        .catch((e) => console.warn('[monitoring] kb snapshot error:', e));
    },
    60 * 60 * 1000,
  ).unref();
}

const authDeps = {
  users: userRepo,
  sessions: sessionRepo,
  passwordHasher,
  idGen: idGenerator,
  sessionTtlMs: sessionTtlMs(),
  now,
  createDefaultWorkspace,
};

// Ежедневная сводка (db/064): один общий SendDailyDigest для планировщика и кнопки
// «Отправить сейчас». Полностью серверная рассылка (почта / личный TG / группа / in-app).
// One-click действия из писем-сводок (db/086): токены + публичный сервис.
const emailActionTokenRepo = new DrizzleEmailActionTokenRepository(db);
const createEmailActionToken = new CreateEmailActionToken({
  tokens: emailActionTokenRepo,
  idGen: idGenerator,
  now,
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 дней на клик
});
const emailActionService = new EmailActionService({
  tokens: emailActionTokenRepo,
  tasks: taskRepo,
  moveTask: new MoveTask({
    projects: projectRepo,
    members: projectMemberRepo,
    tasks: taskRepo,
    delegations: taskDelegationRepo,
    activityRecorder,
  }),
  createTaskComment: createTaskCommentUseCase,
  now,
});

const sendDailyDigest = new SendDailyDigest({
  tasks: taskRepo,
  delegations: taskDelegationRepo,
  comments: taskCommentRepo,
  projects: projectRepo,
  members: projectMemberRepo,
  email: emailSender,
  notifications: notificationRepo,
  telegram: sendAgentTelegramNotification,
  telegramClient,
  settings: digestSettingsRepo,
  appUrl: appBaseUrl,
  idGen: idGenerator,
  createEmailActionToken,
  signingSecret: repoAccessSecret,
});

const { app, devProxyUpgrade } = createApp({
  emailActions: { service: emailActionService, appUrl: appBaseUrl },
  auth: {
    register: new Register(authDeps),
    login: new Login(authDeps),
    logout: new Logout(sessionRepo),
    getCurrentUser: new GetCurrentUser({ users: userRepo, sessions: sessionRepo, now }),
  },
  user: {
    updateProfile: new UpdateProfile(userRepo),
    uploadAvatar: new UploadUserAvatar({ users: userRepo, storage: attachmentStorage }),
    getUserUsage,
    buyPlan,
  },
  fileSync: {
    service: fileSyncService,
    maxBlobBytes: SYNC_MAX_BLOB_BYTES,
  },
  live: {
    service: liveService,
    liveEventHub,
  },
  chat: {
    service: chatService,
    chatEventHub,
    storage: attachmentStorage,
    idGen: idGenerator,
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
  },
  projects: {
    listProjects: new ListProjects({ members: projectMemberRepo, resolveActiveWorkspace }),
    getProject: new GetProject({ projects: projectRepo, members: projectMemberRepo }),
    createProject: new CreateProject({
      repo: projectRepo,
      members: projectMemberRepo,
      idGen: idGenerator,
      resolveWorkspaceId,
      resolveDefaultDispatcher,
      activityRecorder,
    }),
    updateProject: new UpdateProject({ projects: projectRepo, members: projectMemberRepo, activity: activityRecorder }),
    deleteProject: new DeleteProject({
      projects: projectRepo,
      members: projectMemberRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
    }),
    setProjectDispatcher: new SetProjectDispatcher({
      projects: projectRepo,
      members: projectMemberRepo,
      agentTokens: agentTokenRepo,
      users: userRepo,
    }),
    setMultiTaskWorker: new SetProjectMultiTaskWorker({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    listDispatcherCandidates: new ListDispatcherCandidates({
      projects: projectRepo,
      members: projectMemberRepo,
      agentTokens: agentTokenRepo,
      users: userRepo,
    }),
    setGitTokenDelegation: new SetGitTokenDelegation({
      projects: projectRepo,
      members: projectMemberRepo,
      delegations: gitTokenDelegationRepo,
      githubTokens: githubTokenRepo,
      users: userRepo,
    }),
    listGitTokenAccessLog: new ListGitTokenAccessLog({
      projects: projectRepo,
      delegations: gitTokenDelegationRepo,
    }),
    gitTokenDelegations: gitTokenDelegationRepo,
    users: userRepo,
    githubTokens: githubTokenRepo,
    projects: projectRepo,
    reorderProjects: new ReorderProjects({ members: projectMemberRepo }),
    toggleProjectFavorite: new ToggleProjectFavorite({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    reorderFavoriteProjects: new ReorderFavoriteProjects({ members: projectMemberRepo }),
    listProjectCommits: new ListProjectCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      api: githubApi,
    }),
    getOrCreateInbox: new GetOrCreateInbox({
      repo: projectRepo,
      members: projectMemberRepo,
      idGen: idGenerator,
      resolveWorkspaceId,
    }),
    listMembers: new ListProjectMembers({ projects: projectRepo, members: projectMemberRepo }),
    removeMember: new RemoveProjectMember({ projects: projectRepo, members: projectMemberRepo, activityRecorder, hubSync: hubMembershipSync }),
    updateMemberRole: new UpdateProjectMemberRole({
      projects: projectRepo,
      members: projectMemberRepo,
      activityRecorder,
    }),
    transferOwnership: new TransferProjectOwnership({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    createInvite: new CreateProjectInvite({
      projects: projectRepo,
      members: projectMemberRepo,
      invites: projectInviteRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      randomToken: () => randomBytes(32).toString('hex'),
      now,
      ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 дней (см. spec)
      appUrl: appBaseUrl,
    }),
    listInvites: new ListProjectInvites({
      projects: projectRepo,
      members: projectMemberRepo,
      invites: projectInviteRepo,
      now,
    }),
    deleteInvite: new DeleteProjectInvite({
      projects: projectRepo,
      members: projectMemberRepo,
      invites: projectInviteRepo,
    }),
    listSharedMembers: new ListSharedMembers(projectMemberRepo),
    checkGitCollision: new CheckGitCollision({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    requestJoin: new RequestProjectJoin({
      projects: projectRepo,
      members: projectMemberRepo,
      joinRequests: projectJoinRequestRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
    }),
    resolveJoinRequest: new ResolveProjectJoinRequest({
      projects: projectRepo,
      members: projectMemberRepo,
      joinRequests: projectJoinRequestRepo,
      users: userRepo,
      now,
      hubSync: hubMembershipSync,
    }),
    appUrl: process.env['APP_URL'] ?? process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173',
    notifyProjectChanged,
    setActiveWorkspaceForProject,
    members: projectMemberRepo,
    coverStorage: attachmentStorage,
    maxCoverBytes: MAX_COVER_BYTES,
  },
  workspaces: {
    service: workspaceService,
  },
  activity: {
    getFeed: getActivityFeed,
    workspaces: workspaceRepo,
    users: userRepo,
  },
  notifications: {
    list: new ListNotifications({ repo: notificationRepo }),
    countUnread: new CountUnreadNotifications({ repo: notificationRepo }),
    markRead: new MarkNotificationRead({ repo: notificationRepo, now }),
    markAllRead: new MarkAllNotificationsRead({ repo: notificationRepo, now }),
    subscribe: (userId, fn) => notificationHub.subscribe(userId, fn),
    subscribeRealtime: (userId, fn) => realtimeHub.subscribe(userId, fn),
    projectNotifier,
  },
  recentTaskViews: {
    list: new ListRecentTaskViews({ repo: recentTaskViewRepo }),
    record: new RecordTaskView({ repo: recentTaskViewRepo }),
  },
  projectAnalytics: {
    record: new RecordProjectView({
      projects: projectRepo,
      members: projectMemberRepo,
      views: projectViewRepo,
    }),
    getAnalytics: new GetProjectViewsAnalytics({
      projects: projectRepo,
      members: projectMemberRepo,
      views: projectViewRepo,
    }),
    getActivity: new GetProjectActivity({
      projects: projectRepo,
      members: projectMemberRepo,
      activity: activityRepo,
      users: userRepo,
    }),
  },
  help: {
    submit: submitSupportTicket,
    rateLimiter: agentRateLimiter,
  },
  invites: {
    getByToken: new GetInviteByToken({
      invites: projectInviteRepo,
      projects: projectRepo,
      users: userRepo,
      now,
    }),
    accept: new AcceptProjectInvite({
      invites: projectInviteRepo,
      members: projectMemberRepo,
      users: userRepo,
      now,
      activityRecorder,
      hubSync: hubMembershipSync,
    }),
  },
  search: {
    searchTasks: new SearchTasks({ search: taskSearchRepo }),
  },
  telegram: {
    connect: connectTelegramAccount,
    status: getTelegramStatus,
    handler: handleTelegramWebhook,
    webhookSecret: telegramWebhookSecret,
    users: userRepo,
  },
  admin: {
    listAllProjects: new ListAllProjects(adminRepo),
    listAllUsers: new ListAllUsers(adminRepo),
    updateUser: new UpdateUserAsAdmin(adminRepo),
    listUserProjectsWithDispatcher: new ListUserProjectsWithDispatcher({
      members: projectMemberRepo,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
    listUserProjectsWithFavorites: new ListUserProjectsWithFavorites({
      members: projectMemberRepo,
    }),
    setUserProjectFavorite: new SetUserProjectFavorite({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    listAllSupportTickets: new ListAllSupportTickets(supportTicketRepo),
    setSupportTicketStatus: new SetSupportTicketStatus(supportTicketRepo),
    setUserPlanAsAdmin: new SetUserPlanAsAdmin({ users: userRepo, now }),
    emailSender,
  },
  finance: {
    manageEmployees: new ManageEmployees({
      employees: employeeRepo,
      finance: projectFinanceRepo,
      idGen: idGenerator,
      now,
    }),
    manageProjectFinance: new ManageProjectFinance({
      projects: projectRepo,
      members: projectMemberRepo,
      employees: employeeRepo,
      finance: projectFinanceRepo,
      idGen: idGenerator,
      now,
    }),
    getProjectFinance: new GetProjectFinance({
      projects: projectRepo,
      members: projectMemberRepo,
      employees: employeeRepo,
      finance: projectFinanceRepo,
      now,
    }),
  },
  secrets: {
    putSecret: new PutSecret({ projects: projectRepo, members: projectMemberRepo, repo: secretsRepo }),
    getSecret: new GetSecret({ projects: projectRepo, members: projectMemberRepo, repo: secretsRepo }),
    deleteSecret: new DeleteSecret({ projects: projectRepo, members: projectMemberRepo, repo: secretsRepo }),
    listSecretKeys: new ListSecretKeys({ projects: projectRepo, members: projectMemberRepo, repo: secretsRepo }),
  },
  monitoring: {
    listServers: listServersUseCase,
    manageServers,
    queries: monitoringQueries,
    manageAlertRules,
    overview: monitoringOverview,
    alertCenter: monitoringAlertCenter,
    analysisEnqueue: enqueueMonitoringAnalysisJob,
    analysisWaitFor: waitForMonitoringAnalysisJob,
    analysisHistory: listServerAnalysisHistory,
  },
  kb: {
    initKbRepo: new InitKbRepo({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    connectKbRepo: new ConnectKbRepo({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    disconnectKb: new DisconnectKb({ projects: projectRepo, members: projectMemberRepo }),
    initLocalKb: new InitLocalKb({ projects: projectRepo, members: projectMemberRepo }),
    listKbDocuments: new ListKbDocuments({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    getKbDocument: new GetKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    writeKbDocument: new WriteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    deleteKbDocument: new DeleteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    bulkCreateCredential: new BulkCreateCredential({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
      secrets: secretsRepo,
    }),
  },
  tasks: {
    listTasks: new ListTasks({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      attachments: taskAttachmentRepo,
      comments: taskCommentRepo,
      delegations: taskDelegationRepo,
    }),
    createTask: new CreateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
      activityRecorder,
      versions: taskVersionRecorder,
    }),
    updateTask: new UpdateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      activity: activityRecorder,
      versions: taskVersionRecorder,
    }),
    moveTask: new MoveTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      activityRecorder,
      versions: taskVersionRecorder,
    }),
    deleteTask: new DeleteTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      delegations: taskDelegationRepo,
      activityRecorder,
    }),
    getTaskVersions: new GetTaskVersions({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      versions: taskVersionRepo,
      users: userRepo,
      now: () => new Date(),
    }),
    restoreTaskVersion: new RestoreTaskVersion({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      versions: taskVersionRepo,
      users: userRepo,
      now: () => new Date(),
      activity: activityRecorder,
      versionRecorder: taskVersionRecorder,
    }),
    linkCommit: new LinkCommit({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
    unlinkCommit: new UnlinkCommit({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
    }),
    listTaskCommits: new ListTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      delegations: taskDelegationRepo,
    }),
    syncTaskCommits: new SyncTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
    uploadAttachment: new UploadTaskAttachment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
      delegations: taskDelegationRepo,
      idGen: idGenerator,
      maxBytes: MAX_ATTACHMENT_BYTES,
    }),
    deleteAttachment: new DeleteTaskAttachment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
      delegations: taskDelegationRepo,
    }),
    listAttachments: new ListTaskAttachments({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      delegations: taskDelegationRepo,
    }),
    getAttachment: new GetTaskAttachment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
      delegations: taskDelegationRepo,
    }),
    // Секрет для проверки подписанных URL картинок (письмо/Telegram — без сессии).
    signingSecret: repoAccessSecret,
    listComments: new ListTaskComments({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      attachments: taskAttachmentRepo,
      delegations: taskDelegationRepo,
    }),
    createComment: createTaskCommentUseCase,
    updateComment: new UpdateTaskComment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      delegations: taskDelegationRepo,
    }),
    deleteComment: new DeleteTaskComment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      delegations: taskDelegationRepo,
    }),
    requestRalphCancel: new RequestRalphCancel({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
    }),
    revokeRalphCancel: new RevokeRalphCancel({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      users: userRepo,
    }),
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
    notifyTaskChanged,
    notifyCommentAdded,
    notifyStatusChanged,
    // tasks repo — нужен роуту для чтения oldStatus до move'а (SSE task_status_changed).
    tasks: taskRepo,
    maybeReopenForClarification,
    broadcastTelegram: broadcastTelegramByTask,
    dispatchCommentNotifications,
    getCommentNotifications: new GetCommentNotifications({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      log: commentNotificationLogRepo,
      delegations: taskDelegationRepo,
    }),
    exportDigest: new ExportTasksDigest({
      listTasks: new ListTasks({
        projects: projectRepo,
        members: projectMemberRepo,
        tasks: taskRepo,
        taskCommits: taskCommitRepo,
        attachments: taskAttachmentRepo,
        comments: taskCommentRepo,
        delegations: taskDelegationRepo,
      }),
      projects: projectRepo,
      members: projectMemberRepo,
      attachments: taskAttachmentRepo,
      users: userRepo,
      email: emailSender,
      telegram: sendAgentTelegramNotification,
      telegramClient,
      settings: digestSettingsRepo,
      appUrl: appBaseUrl,
    }),
    projectRepo,
  },
  digest: {
    get: new GetDigestSettings({
      projects: projectRepo,
      members: projectMemberRepo,
      settings: digestSettingsRepo,
    }),
    save: new SaveDigestSettings({
      projects: projectRepo,
      members: projectMemberRepo,
      settings: digestSettingsRepo,
      telegram: telegramClient,
    }),
    sendNow: new TriggerDailyDigestNow({
      projects: projectRepo,
      members: projectMemberRepo,
      send: sendDailyDigest,
    }),
  },
  delegations: {
    accept: new AcceptTaskDelegation({
      delegations: taskDelegationRepo,
      tasks: taskRepo,
      projects: projectRepo,
      members: projectMemberRepo,
      users: userRepo,
      notifications: notificationRepo,
      idGen: idGenerator,
    }),
    decline: new DeclineTaskDelegation({
      delegations: taskDelegationRepo,
      tasks: taskRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
    }),
    withdraw: new WithdrawTaskDelegation({ delegations: taskDelegationRepo }),
    listPending: new ListMyPendingDelegations(taskDelegationRepo),
    listAssignedToMe: new ListTasksAssignedToMe({
      delegations: taskDelegationRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      attachments: taskAttachmentRepo,
      comments: taskCommentRepo,
    }),
    assignToProject: new AssignInboxTaskToProject({
      tasks: taskRepo,
      projects: projectRepo,
      members: projectMemberRepo,
      delegations: taskDelegationRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
    }),
    delegateExisting: new DelegateExistingTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
    }),
  },
  agent: {
    createAgentToken: new CreateAgentToken({
      tokens: agentTokenRepo,
      hasher: agentTokenHasher,
      idGen: idGenerator,
      // 32-byte (256-bit) entropy — крипто-случайный токен hex 64 char'а.
      randomToken: () => randomBytes(32).toString('hex'),
    }),
    listAgentTokens: new ListAgentTokens({ tokens: agentTokenRepo }),
    revokeAgentToken: new RevokeAgentToken({ tokens: agentTokenRepo, projects: projectRepo }),
    authenticateAgentToken: new AuthenticateAgentToken({
      tokens: agentTokenRepo,
      hasher: agentTokenHasher,
      users: userRepo,
    }),
    getAgentCredential: new GetAgentCredential({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
      secrets: secretsRepo,
    }),
    getAgentTask: new GetAgentTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      comments: taskCommentRepo,
      storage: attachmentStorage,
    }),
    createAgentCredential: new CreateAgentCredential({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
      secrets: secretsRepo,
    }),
    // Переиспользуем существующие use-cases для agent-эндпоинтов
    listProjects: new ListProjects({ members: projectMemberRepo, resolveActiveWorkspace }),
    createProjectWithGit: new CreateProjectWithGit({
      createProject: new CreateProject({
        repo: projectRepo,
        members: projectMemberRepo,
        idGen: idGenerator,
        resolveWorkspaceId,
        resolveDefaultDispatcher,
        activityRecorder,
      }),
      updateProject: new UpdateProject({ projects: projectRepo, members: projectMemberRepo, activity: activityRecorder }),
      tokens: githubTokenRepo,
      api: githubApi,
    }),
    updateProject: new UpdateProject({ projects: projectRepo, members: projectMemberRepo, activity: activityRecorder }),
    listUserRepos: new ListUserRepos({ tokens: githubTokenRepo, api: githubApi }),
    listKbDocuments: new ListKbDocuments({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    listTasks: new ListTasks({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      attachments: taskAttachmentRepo,
      comments: taskCommentRepo,
      delegations: taskDelegationRepo,
    }),
    createTask: new CreateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
      activityRecorder,
      versions: taskVersionRecorder,
    }),
    createComment: createTaskCommentUseCase,
    // Чтение комментариев задачи (Ralph F11 polling): фильтры since/limit/marker
    // + ownerDisplayName. Не использует ListTaskComments из tasks-блока (та тянет
    // attachments-батч лишний раз).
    listTaskCommentsForAgent: new ListTaskCommentsForAgent({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      users: userRepo,
    }),
    moveTask: new MoveTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      activityRecorder,
      versions: taskVersionRecorder,
    }),
    linkCommit: new LinkCommit({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
    writeKbDocument: new WriteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    requestDeviceCode: new RequestAgentDeviceCode({
      store: agentDeviceCodeStore,
      now,
      ttlMs: 10 * 60 * 1000, // 10 min
      intervalSec: 3,
      // verificationBaseUrl: APP_URL (без '/api'), на проде https://projectsflow.ru.
      // Используем env-vars напрямую — конфиг-объект тут не хочется захламлять,
      // и значение нужно один раз на старте.
      verificationBaseUrl:
        process.env['APP_URL'] ?? process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173',
    }),
    approveDeviceCode: new ApproveAgentDeviceCode({
      store: agentDeviceCodeStore,
      createAgentToken: new CreateAgentToken({
        tokens: agentTokenRepo,
        hasher: agentTokenHasher,
        idGen: idGenerator,
        randomToken: () => randomBytes(32).toString('hex'),
      }),
      now,
    }),
    pollDeviceToken: new PollAgentDeviceToken({ store: agentDeviceCodeStore, now }),
    getDeviceCodeInfo: new GetAgentDeviceCodeInfo({ store: agentDeviceCodeStore, now }),
    // AI prompt-improvement (см. spec 2026-05-28-ai-prompt-improvement-design.md)
    enqueueAiPromptJob,
    waitForAiPromptJob,
    listPendingAiPromptJobs: new ListPendingAiPromptJobs({ aiPromptJobs: aiPromptJobRepo }),
    claimAiPromptJob: new ClaimAiPromptJob({ aiPromptJobs: aiPromptJobRepo }),
    completeAiPromptJob: new CompleteAiPromptJob({ aiPromptJobs: aiPromptJobRepo }),
    listPendingMonitoringAnalysisJobs,
    claimMonitoringAnalysisJob,
    completeMonitoringAnalysisJob,
    listPendingCommitSyncJobs,
    claimCommitSyncJob,
    completeCommitSyncJob,
    dispatchAllowed: new CheckDispatchAllowed({ tasks: taskRepo, taskDelegations: taskDelegationRepo, checkBudget }),
    getAiPromptKbBundle: new GetAiPromptKbBundle({
      aiPromptJobs: aiPromptJobRepo,
      projects: projectRepo,
      members: projectMemberRepo,
      listKbDocuments: new ListKbDocuments({
        projects: projectRepo,
        members: projectMemberRepo,
        kb: kbStore,
      }),
      getKbDocument: new GetKbDocument({
        projects: projectRepo,
        members: projectMemberRepo,
        kb: kbStore,
      }),
    }),
    ackRalphCancel: new AckRalphCancel({ tasks: taskRepo }),
    checkRepoUsage: new CheckRepoUsage({
      projects: projectRepo,
      members: projectMemberRepo,
      tokenSecret: repoAccessSecret,
    }),
    requestRepoAccess: new RequestRepoAccess({
      projects: projectRepo,
      members: projectMemberRepo,
      joinRequests: projectJoinRequestRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
      tokenSecret: repoAccessSecret,
    }),
    initLocalKb: new InitLocalKb({ projects: projectRepo, members: projectMemberRepo }),
    // Расширенный набор agent-операций (MCP 0.10) — те же use-case'ы, что у web-API.
    updateTask: new UpdateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      activity: activityRecorder,
      versions: taskVersionRecorder,
    }),
    deleteTask: new DeleteTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      delegations: taskDelegationRepo,
      activityRecorder,
    }),
    listTaskCommits: new ListTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      delegations: taskDelegationRepo,
    }),
    syncTaskCommits: new SyncTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
    searchTasks: new SearchTasks({ search: taskSearchRepo }),
    getProject: new GetProject({ projects: projectRepo, members: projectMemberRepo }),
    listProjectMembers: new ListProjectMembers({ projects: projectRepo, members: projectMemberRepo }),
    getKbDocument: new GetKbDocument({ projects: projectRepo, members: projectMemberRepo, kb: kbStore }),
    deleteKbDocument: new DeleteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    getProjectFinance: new GetProjectFinance({
      projects: projectRepo,
      members: projectMemberRepo,
      employees: employeeRepo,
      finance: projectFinanceRepo,
      now,
    }),
    manageProjectFinance: new ManageProjectFinance({
      projects: projectRepo,
      members: projectMemberRepo,
      employees: employeeRepo,
      finance: projectFinanceRepo,
      idGen: idGenerator,
      now,
    }),
    getMyAccount: new GetMyAccount({
      users: userRepo,
      githubTokens: githubTokenRepo,
      agentTokens: agentTokenRepo,
    }),
    deleteProject: new DeleteProject({
      projects: projectRepo,
      members: projectMemberRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
    }),
    listMyDispatchedProjects: new ListMyDispatchedProjects({
      projects: projectRepo,
      tasks: taskRepo,
      aiPromptJobs: aiPromptJobRepo,
      automation: automationRepo,
    }),
    // Автоматизация проектов (см. план virtual-exploring-pascal.md). Site-side (config/save)
    // и agent-side (dispatcher view / record-task) use-case'ы — все через automationRepo.
    getAutomationConfig: new GetAutomationConfig({
      projects: projectRepo,
      members: projectMemberRepo,
      automation: automationRepo,
    }),
    saveAutomationConfig: new SaveAutomationConfig({
      projects: projectRepo,
      members: projectMemberRepo,
      automation: automationRepo,
    }),
    getAutomationForDispatcher: new GetAutomationForDispatcher({
      projects: projectRepo,
      members: projectMemberRepo,
      automation: automationRepo,
      users: userRepo,
      now,
    }),
    recordAutomationTask: new RecordAutomationTask({
      projects: projectRepo,
      members: projectMemberRepo,
      automation: automationRepo,
      users: userRepo,
      now,
    }),
    ingestAgentSnapshot,
    listMonitoredServers,
    setProjectDispatcher: new SetProjectDispatcher({
      projects: projectRepo,
      members: projectMemberRepo,
      agentTokens: agentTokenRepo,
      users: userRepo,
    }),
    getDelegatedGitToken: new GetDelegatedGitToken({
      projects: projectRepo,
      delegations: gitTokenDelegationRepo,
      githubTokens: githubTokenRepo,
      users: userRepo,
    }),
    rateLimiter: agentRateLimiter,
    dispatchCommentNotifications,
    sendTelegramNotification: sendAgentTelegramNotification,
    broadcastTelegramByTask,
    projects: projectRepo,
  },
  github: {
    startDeviceFlow: new StartDeviceFlow({
      api: githubApi,
      storeDeviceCode: (userId, deviceCode, interval, expiresAt) =>
        deviceFlowStore.store(userId, deviceCode, interval, expiresAt),
      now,
    }),
    pollDeviceFlow: new PollDeviceFlow({
      api: githubApi,
      tokens: githubTokenRepo,
      getDeviceCode: (userId) => deviceFlowStore.get(userId),
      updateInterval: (userId, ms) => deviceFlowStore.setInterval(userId, ms),
      clearDeviceCode: (userId) => deviceFlowStore.clear(userId),
      now,
    }),
    disconnectGithub: new DisconnectGithub(githubTokenRepo),
    listUserRepos: new ListUserRepos({ tokens: githubTokenRepo, api: githubApi }),
    tokens: githubTokenRepo,
  },
});

// Ежедневная сводка по задачам (db/064). Полностью серверный планировщик: тик раз в
// минуту, шлёт по выбранным каналам (почта / личный TG / группа / in-app уведомление).
const dailyDigestScheduler = new DailyDigestScheduler({
  settings: digestSettingsRepo,
  send: sendDailyDigest,
});
dailyDigestScheduler.start();

// Ежедневная commit-sync (db/072): тик раз в минуту ставит job на проекты с включённой
// авто-обработкой статусов по коммитам в заданное МSK-время. Зеркало DailyDigestScheduler.
const commitSyncScheduler = new CommitSyncScheduler({
  automation: automationRepo,
  enqueue: enqueueCommitSyncJob,
});
commitSyncScheduler.start();

const server = app.listen(config.port, () => {
  console.log(
    `[projectsflow] listening on http://127.0.0.1:${config.port} (${config.nodeEnv})`,
  );
  console.log(
    `[projectsflow] github integration: ${config.github.clientId ? 'enabled' : 'DISABLED (no GITHUB_CLIENT_ID)'}`,
  );
  // Telegram mode: TELEGRAM_MODE = 'webhook' | 'polling' | 'auto' (default).
  // auto = webhook если задан URL+secret, иначе polling. Полезно для хостингов где
  // inbound от Telegram блокируется — там webhook никогда не доставит апдейты.
  const tgMode = (process.env['TELEGRAM_MODE'] || 'auto').toLowerCase();
  if (telegramBotToken) {
    // Меню команд бота (кнопка «/» в TG-клиенте) — discoverability функционала. Best-effort.
    void telegramClient
      .setMyCommands([
        { command: 'tasks', description: 'Мои проекты и задачи' },
        { command: 'pending', description: 'Задачи на уточнении' },
        { command: 'pause', description: 'Выключить уведомления' },
        { command: 'help', description: 'Что умеет бот' },
        { command: 'start', description: 'Подключить бота' },
      ])
      .catch((err) => console.warn('[projectsflow] telegram setMyCommands failed:', err));
  }
  if (!telegramBotToken) {
    console.log('[projectsflow] telegram bot: DISABLED (missing TELEGRAM_BOT_TOKEN)');
  } else if (
    tgMode === 'webhook' ||
    (tgMode === 'auto' && telegramWebhookUrl && telegramWebhookSecret)
  ) {
    if (!telegramWebhookUrl || !telegramWebhookSecret) {
      console.warn(
        '[projectsflow] telegram: webhook mode requested, но TELEGRAM_WEBHOOK_URL/SECRET пусты — fallback на polling',
      );
      void telegramPoller.start().catch((err) => console.warn('[tg-poller] start failed:', err));
    } else {
      telegramClient
        .setWebhook(telegramWebhookUrl, telegramWebhookSecret)
        .then(() => console.log(`[projectsflow] telegram webhook: ${telegramWebhookUrl}`))
        .catch((err) => console.warn('[projectsflow] telegram setWebhook failed:', err));
    }
  } else if (tgMode === 'polling' || tgMode === 'auto') {
    void telegramPoller.start().catch((err) => console.warn('[tg-poller] start failed:', err));
  } else {
    console.warn(`[projectsflow] telegram: unknown TELEGRAM_MODE='${tgMode}'`);
  }
});

// HMR-WebSocket: Vite-клиент конектится через тот же Express'овый origin.
// Без этого hot-reload не работает через dev-gateway.
if (devProxyUpgrade) {
  server.on('upgrade', devProxyUpgrade);
  console.log('[projectsflow] dev gateway: proxying SPA + HMR to Vite');
}

// Грациозный shutdown — закрываем pool, иначе процесс висит. Также останавливаем
// TG-поллер (он сам завершит long-poll по timeout от Telegram).
const shutdown = (signal: string): void => {
  console.log(`[projectsflow] received ${signal}, shutting down`);
  void telegramPoller.stop();
  server.close(() => {
    pool.end().then(() => {
      console.log('[projectsflow] pool closed, bye');
      process.exit(0);
    });
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
