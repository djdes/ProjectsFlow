import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  InvalidCredentialsError,
  UserEmailAlreadyExistsError,
  UserNotFoundError,
} from '../../domain/user/errors.js';
import {
  CannotDeleteInboxError,
  CannotFavoriteInboxError,
  CannotInviteToInboxError,
  CannotRemoveSelfAsLastOwnerError,
  GithubNotConnectedForDelegationError,
  GitTokenDelegationDisabledError,
  GranterGithubDisconnectedError,
  GranterNotOwnerAnymoreError,
  InsufficientProjectRoleError,
  NoEligibleGrantorError,
  NotProjectDispatcherError,
  NotProjectMemberForDelegationError,
  ProjectInviteAlreadyUsedError,
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
  ProjectNameAlreadyExistsError,
  ProjectNameEmptyError,
  ProjectNotFoundError,
  ProjectRepoAlreadyConnectedError,
  ProjectArchiveInvalidError,
} from '../../domain/project/errors.js';
import { DispatcherCandidateInvalidError } from '../../application/project/SetProjectDispatcher.js';
import {
  GithubApiError,
  GithubEmptyRepoAlreadyExistsError,
  GithubImportRepoNotEmptyError,
  GithubImportRepoNotFoundError,
  GithubImportRepoNotWritableError,
  GithubIntegrationDisabledError,
  GithubNotConnectedError,
  GithubRepoNameTakenError,
  GithubRepoUrlInvalidError,
} from '../../domain/github/errors.js';
import {
  SecretKeyInvalidError,
  SecretNotFoundError,
} from '../../domain/secrets/errors.js';
import {
  SyncWorkspaceNotFoundError,
  SyncSnapshotNotFoundError,
  SyncSessionNotFoundError,
  SnapshotNotSealedError,
  BlobShaMismatchError,
  BlobMissingError,
  SyncQuotaExceededError,
  BaseMovedConflictError,
  IgnoreSetMismatchError,
  InvalidManifestPathError,
  CaseCollisionError,
  NotAssignedDispatcherError,
} from '../../domain/file-sync/errors.js';
import {
  FrontmatterInvalidError,
  KbDocumentNotFoundError,
  KbNotConnectedError,
  KbRepoAlreadyConnectedError,
  KbRepoConflictError,
} from '../../domain/kb/errors.js';
import {
  TaskAttachmentNotFoundError,
  TaskAttachmentTooLargeError,
  TaskAttachmentTypeNotAllowedError,
  TaskCommentBodyEmptyError,
  TaskCommentNotFoundError,
  TaskCommitNotFoundError,
  TaskDescriptionEmptyError,
  AssigneeNotProjectMemberError,
  AssigneeNotSharedMemberError,
  TaskNotFoundError,
  InboxOwnerRequiredError,
} from '../../domain/task/errors.js';
import { TaskNotActiveError } from '../../application/task/RequestRalphCancel.js';
import { RalphCancelNotRequestedByYouError } from '../../application/task/RevokeRalphCancel.js';
import {
  AgentDeviceCodeAlreadyApprovedError,
  AgentDeviceCodeConsumedError,
  AgentDeviceCodeDeniedError,
  AgentDeviceCodeExpiredError,
  AgentDeviceCodeNotFoundError,
  AgentDeviceCodePendingError,
  AgentTokenInvalidError,
  AgentTokenNameEmptyError,
  AgentTokenNotFoundError,
  AgentCapabilityForbiddenError,
  AgentCapabilityTaskMismatchError,
  AgentCapabilityNotFoundError,
  RequestTargetStaleError,
} from '../../domain/agent/errors.js';
import {
  AiPromptJobAlreadyClaimedError,
  AiPromptJobNotInRunningStateError,
  NotDispatcherForAiPromptJobError,
} from '../../domain/ai-prompt/errors.js';
import {
  AssignmentNotFoundError,
  EmployeeNotFoundError,
  FinanceValidationError,
} from '../../domain/finance/errors.js';
import {
  LogPathNotAllowedError,
  NotLocalServerError,
  ServerNameInvalidError,
  ServerNotFoundError,
  SnapshotIngestInvalidError,
} from '../../domain/monitoring/errors.js';
import {
  LiveSessionNotFoundError,
  LiveSessionGoneError,
} from '../../domain/live/errors.js';
import { PlanRequiredError, PrimeTrialUsedError, UsageBlockedError, VipNotSelfServeError } from '../../domain/usage/errors.js';
import {
  WorkspaceNotFoundError,
  NotWorkspaceMemberError,
  NotWorkspaceOwnerError,
  NotWorkspaceEditorError,
  LastOwnerError,
  WorkspaceNotEmptyError,
  CannotDeleteLastWorkspaceError,
  CannotDeleteDefaultWorkspaceError,
  WorkspaceNameEmptyError,
  UserNotFoundByEmailError,
  NotProjectOwnerError,
  WorkspaceInviteNotFoundError,
  WorkspaceInviteExpiredError,
  WorkspaceInviteAlreadyUsedError,
  CannotInviteToDefaultWorkspaceError,
} from '../../domain/workspace/errors.js';
import {
  ChatMessageNotFoundError,
  NotMessageAuthorError,
  CannotDeleteMessageError,
  MessageDeletedError,
  EmptyMessageError,
  ChatAttachmentNotFoundError,
  ChatAttachmentTooLargeError,
} from '../../domain/chat/errors.js';

type ErrorPayload = {
  error: string;
  message?: string;
  details?: unknown;
};

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    // Делаем message человеко-читаемым: первое нарушение с путём поля. Так клиент,
    // который видит только текст ошибки (Ralph dispatcher на .NET читает только status),
    // получит "targetStatus: Invalid enum value..." вместо безликого "Validation failed".
    // details[] всё ещё доступны для тех, кто читает тело целиком.
    const first = err.issues[0];
    const message = first
      ? `${first.path.length > 0 ? first.path.join('.') + ': ' : ''}${first.message}`
      : 'Validation failed';
    res.status(400).json({
      error: 'bad_request',
      message,
      details: err.issues,
    } satisfies ErrorPayload);
    return;
  }

  if (err instanceof UserEmailAlreadyExistsError) {
    res.status(409).json({ error: 'email_taken', message: 'Email уже занят' });
    return;
  }

  if (err instanceof InvalidCredentialsError) {
    res.status(401).json({ error: 'invalid_credentials', message: 'Неверный email или пароль' });
    return;
  }

  if (err instanceof UserNotFoundError) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }

  if (err instanceof ProjectNameAlreadyExistsError) {
    res.status(409).json({ error: 'project_name_taken', message: 'Проект с таким именем уже есть' });
    return;
  }

  if (err instanceof ProjectNameEmptyError) {
    res.status(400).json({ error: 'project_name_empty', message: 'Введите название' });
    return;
  }

  if (err instanceof ProjectNotFoundError) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  if (err instanceof InsufficientProjectRoleError) {
    res.status(403).json({
      error: 'insufficient_role',
      message: 'Недостаточно прав в проекте',
      details: { role: err.haveRole, action: err.requiredAction },
    });
    return;
  }

  if (err instanceof ProjectInviteNotFoundError) {
    res.status(404).json({ error: 'invite_not_found', message: 'Приглашение не найдено' });
    return;
  }
  if (err instanceof ProjectInviteExpiredError) {
    res.status(410).json({ error: 'invite_expired', message: 'Срок действия приглашения истёк' });
    return;
  }
  if (err instanceof ProjectInviteAlreadyUsedError) {
    res.status(410).json({ error: 'invite_used', message: 'Это приглашение уже использовано' });
    return;
  }
  if (err instanceof CannotInviteToInboxError) {
    res.status(409).json({
      error: 'cannot_invite_to_inbox',
      message: 'Во «Входящие» нельзя приглашать — это личное пространство',
    });
    return;
  }
  if (err instanceof CannotDeleteInboxError) {
    res.status(409).json({
      error: 'cannot_delete_inbox',
      message: 'Папку «Входящие» нельзя удалить — это служебный проект',
    });
    return;
  }
  if (err instanceof CannotFavoriteInboxError) {
    res.status(409).json({
      error: 'cannot_favorite_inbox',
      message: 'Папку «Входящие» нельзя добавить в избранное',
    });
    return;
  }
  // === Git-token delegation errors ===
  if (err instanceof NotProjectDispatcherError) {
    res.status(403).json({
      error: 'not_dispatcher',
      message: 'Только текущий Ralph-диспетчер проекта может получить делегированный токен',
    });
    return;
  }
  if (err instanceof GitTokenDelegationDisabledError) {
    res.status(403).json({
      error: 'delegation_disabled',
      message: 'Владелец проекта не разрешил делегирование GitHub-токена',
    });
    return;
  }
  if (err instanceof GranterNotOwnerAnymoreError) {
    res.status(403).json({
      error: 'granter_not_owner_anymore',
      message: 'Юзер, который разрешил делегацию, больше не владелец проекта — нужно заново включить от нового владельца',
    });
    return;
  }
  if (err instanceof GranterGithubDisconnectedError) {
    res.status(410).json({
      error: 'granter_github_disconnected',
      message: 'Владелец отключил GitHub — попроси его подключить заново на /profile',
    });
    return;
  }
  if (err instanceof GithubNotConnectedForDelegationError) {
    res.status(400).json({
      error: 'github_not_connected',
      message: 'Подключи GitHub на /profile, потом включай делегацию',
    });
    return;
  }
  if (err instanceof NoEligibleGrantorError) {
    // candidatesChecked отдаём в body — для диагностики на стороне Ralph'а
    // («сколько кандидатов проверили, у скольких нет GitHub»).
    res.status(403).json({
      error: 'no_eligible_grantor',
      candidatesChecked: err.candidatesChecked,
      message:
        'Никто из членов с включённой делегацией не имеет подключённого GitHub. ' +
        'Попроси owner\'а или активного контрибутора подключить GitHub на /profile.',
    });
    return;
  }
  if (err instanceof NotProjectMemberForDelegationError) {
    res.status(403).json({
      error: 'not_project_member',
      message:
        'Включать делегацию своего GitHub-токена может только участник проекта. ' +
        'Admin может управлять делегацией любого участника.',
    });
    return;
  }
  if (err instanceof DispatcherCandidateInvalidError) {
    const message =
      err.reason === 'not_member'
        ? 'Этот юзер не является участником проекта (диспетчером может быть только member или admin)'
        : err.reason === 'no_active_tokens'
          ? 'У этого юзера нет активных agent-токенов — он не сможет работать как Ralph-диспетчер'
          : 'Юзер не найден';
    res.status(400).json({ error: `dispatcher_${err.reason}`, message });
    return;
  }
  if (err instanceof CannotRemoveSelfAsLastOwnerError) {
    res.status(409).json({
      error: 'last_owner',
      message: 'Нельзя удалить или понизить себя как единственного владельца',
    });
    return;
  }

  if (err instanceof GithubIntegrationDisabledError) {
    res.status(503).json({
      error: 'github_integration_disabled',
      message: 'GitHub-интеграция не настроена администратором.',
    });
    return;
  }

  if (err instanceof GithubNotConnectedError) {
    res.status(409).json({
      error: 'github_not_connected',
      message: 'Сначала подключи GitHub в профиле.',
    });
    return;
  }

  if (err instanceof GithubRepoNameTakenError) {
    res.status(422).json({
      error: 'github_repo_name_taken',
      message: 'Репозиторий с таким именем уже существует.',
    });
    return;
  }

  if (err instanceof ProjectRepoAlreadyConnectedError) {
    res.status(409).json({
      error: 'repo_already_connected',
      message: 'У проекта уже подключён репозиторий.',
    });
    return;
  }

  if (err instanceof GithubRepoUrlInvalidError) {
    res.status(422).json({
      error: 'github_repo_url_invalid',
      message: 'Не удалось определить owner/repo из URL.',
    });
    return;
  }

  if (err instanceof GithubApiError) {
    // Логируем upstream-ошибку — без логов отлаживать private-repo проблемы невозможно.
    console.error(`[github_api_error] status=${err.status} message=${err.message}`);
    res.status(err.status === 401 ? 401 : 502).json({
      error: 'github_api_error',
      message: err.message,
      details: { upstreamStatus: err.status },
    });
    return;
  }

  if (err instanceof SecretNotFoundError) {
    res.status(404).json({ error: 'secret_not_found' });
    return;
  }
  if (err instanceof SecretKeyInvalidError) {
    res.status(400).json({ error: 'secret_key_invalid', message: err.message });
    return;
  }

  if (err instanceof KbNotConnectedError) {
    res.status(409).json({ error: 'kb_not_connected', message: 'У проекта нет привязанного KB-репо' });
    return;
  }
  if (err instanceof KbRepoAlreadyConnectedError) {
    res.status(409).json({ error: 'kb_already_connected' });
    return;
  }
  if (err instanceof KbDocumentNotFoundError) {
    res.status(404).json({ error: 'kb_doc_not_found' });
    return;
  }
  if (err instanceof FrontmatterInvalidError) {
    res.status(422).json({ error: 'frontmatter_invalid', details: err.errors });
    return;
  }
  if (err instanceof KbRepoConflictError) {
    res.status(409).json({ error: 'kb_conflict' });
    return;
  }

  if (err instanceof TaskNotFoundError) {
    res.status(404).json({ error: 'task_not_found' });
    return;
  }
  if (err instanceof TaskDescriptionEmptyError) {
    res.status(400).json({ error: 'task_description_empty', message: 'Введите описание задачи' });
    return;
  }
  if (err instanceof ProjectArchiveInvalidError) {
    res.status(400).json({ error: 'project_archive_invalid', message: err.message });
    return;
  }

  if (err instanceof GithubEmptyRepoAlreadyExistsError) {
    res.status(409).json({
      error: 'github_empty_repo_exists',
      message: 'Нашли твой пустой репозиторий с таким именем. Можно импортировать проект прямо в него.',
      details: { repo: { fullName: err.fullName, htmlUrl: err.htmlUrl } },
    });
    return;
  }

  if (err instanceof GithubImportRepoNotFoundError) {
    res.status(404).json({
      error: 'github_import_repo_not_found',
      message: 'Репозиторий не найден или больше недоступен.',
    });
    return;
  }

  if (err instanceof GithubImportRepoNotWritableError) {
    res.status(403).json({
      error: 'github_import_repo_not_writable',
      message: 'У подключённого GitHub-аккаунта нет права записи в этот репозиторий.',
    });
    return;
  }

  if (err instanceof GithubImportRepoNotEmptyError) {
    res.status(409).json({
      error: 'github_import_repo_not_empty',
      message: 'В репозитории уже есть коммиты. Чтобы не перезаписать данные, импорт остановлен.',
    });
    return;
  }

  if (err instanceof Error && err.message === 'project_archive_missing') {
    res.status(400).json({ error: 'project_archive_missing', message: 'Выберите ZIP-архив' });
    return;
  }
  if (err instanceof Error && err.message === 'project_archive_type_invalid') {
    res.status(415).json({ error: 'project_archive_type_invalid', message: 'Поддерживается ZIP-архив' });
    return;
  }
  if (err instanceof AssigneeNotProjectMemberError) {
    res.status(403).json({ error: 'assignee_not_project_member', message: err.message });
    return;
  }
  if (err instanceof AssigneeNotSharedMemberError) {
    res.status(403).json({ error: 'assignee_not_shared_member', message: err.message });
    return;
  }
  if (err instanceof TaskCommitNotFoundError) {
    res.status(404).json({ error: 'task_commit_not_found' });
    return;
  }
  if (err instanceof TaskAttachmentNotFoundError) {
    res.status(404).json({ error: 'task_attachment_not_found' });
    return;
  }
  if (err instanceof TaskAttachmentTooLargeError) {
    res.status(413).json({
      error: 'task_attachment_too_large',
      message: `Файл больше лимита (${Math.round(err.maxBytes / 1024 / 1024)} MB)`,
    });
    return;
  }
  if (err instanceof TaskAttachmentTypeNotAllowedError) {
    res.status(415).json({
      error: 'task_attachment_type_not_allowed',
      message: 'Можно загружать только картинки (PNG, JPEG, WebP, GIF)',
    });
    return;
  }
  if (err instanceof TaskCommentNotFoundError) {
    res.status(404).json({ error: 'task_comment_not_found' });
    return;
  }
  if (err instanceof TaskCommentBodyEmptyError) {
    res.status(400).json({ error: 'task_comment_body_empty', message: 'Введите текст комментария' });
    return;
  }
  if (err instanceof TaskNotActiveError) {
    res.status(409).json({ error: 'task_not_active', message: err.message });
    return;
  }

  if (err instanceof InboxOwnerRequiredError) {
    res.status(403).json({ error: 'inbox_owner_required', message: err.message });
    return;
  }
  if (err instanceof RalphCancelNotRequestedByYouError) {
    res.status(403).json({ error: 'ralph_cancel_not_yours', message: err.message });
    return;
  }

  // multer-specific: MulterError имеет .code; LIMIT_FILE_SIZE превышен — отдадим 413.
  // Лучше отлавливать по конструктору, но импортировать multer типы здесь не хочется
  // (errorHandler не должен знать про multer). Code-сниффинг по duck-typing.
  const maybeMulter = err as { name?: string; code?: string } | null;
  if (maybeMulter?.name === 'MulterError' && maybeMulter.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      error: 'task_attachment_too_large',
      message: 'Файл больше лимита',
    });
    return;
  }

  if (err instanceof AgentTokenNameEmptyError) {
    res.status(400).json({ error: 'agent_token_name_empty', message: 'Введите название токена' });
    return;
  }
  if (err instanceof AgentTokenNotFoundError) {
    res.status(404).json({ error: 'agent_token_not_found' });
    return;
  }
  if (err instanceof AgentTokenInvalidError) {
    res.status(401).json({ error: 'agent_token_invalid' });
    return;
  }
  if (err instanceof AgentCapabilityForbiddenError) {
    res.status(403).json({ error: 'agent_capability_forbidden' });
    return;
  }
  if (err instanceof AgentCapabilityTaskMismatchError) {
    res.status(400).json({ error: 'agent_capability_task_mismatch' });
    return;
  }
  if (err instanceof AgentCapabilityNotFoundError) {
    res.status(404).json({ error: 'agent_capability_not_found' });
    return;
  }

  // AI prompt-job errors (см. spec 2026-05-28-ai-prompt-improvement-design.md)
  // AiPromptJobNotFoundError / AccessDeniedError мапятся inline в роутах,
  // потому что 404/403-семантика отличается от других случаев.
  if (err instanceof AiPromptJobAlreadyClaimedError) {
    res.status(409).json({ error: 'ai_prompt_job_already_claimed', message: err.message });
    return;
  }
  if (err instanceof AiPromptJobNotInRunningStateError) {
    res.status(409).json({ error: 'ai_prompt_job_not_in_running_state', message: err.message });
    return;
  }
  if (err instanceof NotDispatcherForAiPromptJobError) {
    res.status(403).json({ error: 'not_dispatcher_for_job', message: err.message });
    return;
  }

  // Device flow errors — статусы выровнены под OAuth 2.0 device authorization grant (RFC 8628).
  // MCP-клиент по конкретному коду error в body решает: ждать ещё (pending) или показать ошибку.
  if (err instanceof AgentDeviceCodePendingError) {
    res.status(202).json({ error: 'authorization_pending' });
    return;
  }
  if (err instanceof AgentDeviceCodeNotFoundError) {
    res.status(404).json({ error: 'device_code_not_found', message: 'Код не найден' });
    return;
  }
  if (err instanceof AgentDeviceCodeExpiredError) {
    res.status(410).json({ error: 'expired_token', message: 'Срок действия кода истёк' });
    return;
  }
  if (err instanceof AgentDeviceCodeConsumedError) {
    res.status(410).json({ error: 'consumed_token', message: 'Код уже использован' });
    return;
  }
  if (err instanceof AgentDeviceCodeDeniedError) {
    res.status(403).json({ error: 'access_denied', message: 'Подключение отклонено' });
    return;
  }
  if (err instanceof AgentDeviceCodeAlreadyApprovedError) {
    res.status(409).json({ error: 'already_approved', message: 'Код уже approved' });
    return;
  }

  if (err instanceof RequestTargetStaleError) {
    res.status(400).json({ error: 'request_target_stale', message: 'requestTarget устарел или не соответствует репозиторию' });
    return;
  }

  if (err instanceof EmployeeNotFoundError) {
    res.status(404).json({ error: 'employee_not_found' });
    return;
  }
  if (err instanceof AssignmentNotFoundError) {
    res.status(404).json({ error: 'assignment_not_found' });
    return;
  }
  if (err instanceof FinanceValidationError) {
    res.status(400).json({ error: 'finance_validation', message: err.message });
    return;
  }

  // --- file-sync ---
  if (err instanceof SyncWorkspaceNotFoundError) {
    res.status(404).json({ error: 'sync_workspace_not_found' });
    return;
  }
  if (err instanceof SyncSnapshotNotFoundError) {
    res.status(404).json({ error: 'sync_snapshot_not_found' });
    return;
  }
  if (err instanceof SyncSessionNotFoundError) {
    res.status(404).json({ error: 'sync_session_not_found' });
    return;
  }
  if (err instanceof SnapshotNotSealedError) {
    res.status(409).json({ error: 'snapshot_not_sealed' });
    return;
  }
  if (err instanceof BlobShaMismatchError) {
    res.status(422).json({ error: 'blob_sha_mismatch', message: err.message });
    return;
  }
  if (err instanceof BlobMissingError) {
    res.status(409).json({ error: 'blob_missing', message: err.message });
    return;
  }
  if (err instanceof SyncQuotaExceededError) {
    res.status(413).json({ error: 'sync_quota_exceeded', message: err.message });
    return;
  }
  if (err instanceof BaseMovedConflictError) {
    res.status(409).json({ error: 'base_moved', message: err.message });
    return;
  }
  if (err instanceof IgnoreSetMismatchError) {
    res.status(409).json({ error: 'ignore_set_mismatch', message: err.message });
    return;
  }
  if (err instanceof InvalidManifestPathError) {
    res.status(422).json({ error: 'invalid_manifest_path', message: err.message });
    return;
  }
  if (err instanceof CaseCollisionError) {
    res.status(422).json({ error: 'case_collision', message: err.message });
    return;
  }
  if (err instanceof NotAssignedDispatcherError) {
    res.status(403).json({ error: 'not_assigned_dispatcher' });
    return;
  }

  // --- мониторинг серверов ---
  if (err instanceof ServerNotFoundError) {
    res.status(404).json({ error: 'server_not_found' });
    return;
  }
  if (err instanceof ServerNameInvalidError) {
    res.status(400).json({ error: 'server_name_invalid', message: err.message });
    return;
  }
  if (err instanceof SnapshotIngestInvalidError) {
    res.status(422).json({ error: 'snapshot_ingest_invalid', message: err.reason });
    return;
  }
  if (err instanceof NotLocalServerError) {
    res.status(409).json({ error: 'not_local_server', message: err.message });
    return;
  }
  if (err instanceof LogPathNotAllowedError) {
    res.status(403).json({ error: 'log_path_not_allowed' });
    return;
  }

  // --- LIVE-вкладка ---
  if (err instanceof LiveSessionNotFoundError) {
    res.status(404).json({ error: 'live_session_not_found' });
    return;
  }
  if (err instanceof LiveSessionGoneError) {
    res.status(410).json({ error: 'live_session_gone', message: err.message });
    return;
  }

  // --- Лимиты подписки (usage). 402: окно исчерпано — раннер трактует как «пропусти, повтори». ---
  if (err instanceof UsageBlockedError) {
    res.status(402).json({
      error: 'budget_exceeded',
      message: 'Лимит использования исчерпан — подождите сброса окна или повысьте тариф',
      details: {
        window: err.window,
        resetsAt: err.resetsAt ? err.resetsAt.toISOString() : null,
      },
    });
    return;
  }
  // free-инициатор пытается запустить работу на диспетчере — нет доступа (нужен Prime/VIP).
  if (err instanceof PlanRequiredError) {
    res.status(402).json({
      error: 'plan_required',
      message: 'Диспетчер доступен на тарифах Прайм и ВИП — оформите подписку',
    });
    return;
  }
  if (err instanceof PrimeTrialUsedError) {
    res.status(409).json({
      error: 'prime_trial_used',
      message: 'Пробный Прайм уже был активирован. Подключить тариф можно по запросу.',
    });
    return;
  }
  if (err instanceof VipNotSelfServeError) {
    res.status(403).json({
      error: 'vip_not_self_serve',
      message: 'Тариф VIP подключается по запросу — обратитесь в поддержку.',
    });
    return;
  }

  // --- Пространства (workspaces) ---
  if (err instanceof WorkspaceNotFoundError || err instanceof NotWorkspaceMemberError) {
    // Не разглашаем существование чужого пространства — 404 и для not-found, и для not-member.
    res.status(404).json({ error: 'workspace_not_found' });
    return;
  }
  if (err instanceof NotWorkspaceOwnerError) {
    res.status(403).json({ error: 'not_workspace_owner', message: 'Нужны права владельца пространства' });
    return;
  }
  if (err instanceof NotWorkspaceEditorError) {
    res.status(403).json({ error: 'not_workspace_editor', message: 'Нужны права редактора пространства' });
    return;
  }
  if (err instanceof NotProjectOwnerError) {
    res.status(403).json({ error: 'not_project_owner', message: 'Переносить проект может только его владелец' });
    return;
  }
  if (err instanceof LastOwnerError) {
    res.status(409).json({ error: 'workspace_last_owner', message: 'Нельзя удалить или понизить единственного владельца' });
    return;
  }
  if (err instanceof WorkspaceInviteNotFoundError) {
    res.status(404).json({ error: 'invite_not_found', message: 'Приглашение не найдено' });
    return;
  }
  if (err instanceof WorkspaceInviteExpiredError) {
    res.status(410).json({ error: 'invite_expired', message: 'Срок действия приглашения истёк' });
    return;
  }
  if (err instanceof WorkspaceInviteAlreadyUsedError) {
    res.status(410).json({ error: 'invite_used', message: 'Это приглашение уже использовано' });
    return;
  }
  if (err instanceof CannotInviteToDefaultWorkspaceError) {
    res.status(409).json({
      error: 'cannot_invite_to_default_workspace',
      message: 'В личное пространство пригласить нельзя',
    });
    return;
  }
  if (err instanceof WorkspaceNotEmptyError) {
    res.status(409).json({ error: 'workspace_not_empty', message: 'Сначала перенесите или удалите проекты пространства' });
    return;
  }
  if (err instanceof CannotDeleteLastWorkspaceError) {
    res.status(409).json({ error: 'workspace_last', message: 'Нельзя удалить единственное пространство' });
    return;
  }
  if (err instanceof CannotDeleteDefaultWorkspaceError) {
    res.status(409).json({ error: 'workspace_default', message: 'Нельзя удалить пространство по умолчанию' });
    return;
  }
  if (err instanceof WorkspaceNameEmptyError) {
    res.status(400).json({ error: 'workspace_name_empty', message: 'Введите название пространства' });
    return;
  }
  if (err instanceof UserNotFoundByEmailError) {
    res.status(404).json({ error: 'user_not_found_by_email', message: 'Пользователь с таким email не найден' });
    return;
  }

  // --- Чат пространства ---
  if (err instanceof ChatMessageNotFoundError) {
    res.status(404).json({ error: 'chat_message_not_found' });
    return;
  }
  if (err instanceof NotMessageAuthorError) {
    res.status(403).json({ error: 'not_message_author', message: 'Редактировать может только автор' });
    return;
  }
  if (err instanceof CannotDeleteMessageError) {
    res.status(403).json({ error: 'cannot_delete_message', message: 'Удалить может автор или владелец пространства' });
    return;
  }
  if (err instanceof MessageDeletedError) {
    res.status(409).json({ error: 'message_deleted', message: 'Сообщение удалено' });
    return;
  }
  if (err instanceof EmptyMessageError) {
    res.status(400).json({ error: 'empty_message', message: 'Введите текст или прикрепите файл' });
    return;
  }
  if (err instanceof ChatAttachmentNotFoundError) {
    res.status(404).json({ error: 'chat_attachment_not_found' });
    return;
  }
  if (err instanceof ChatAttachmentTooLargeError) {
    res.status(413).json({
      error: 'chat_attachment_too_large',
      message: `Файл больше лимита (${Math.round(err.maxBytes / 1024 / 1024)} MB)`,
    });
    return;
  }

  if (
    err instanceof Error
    && ['invalid_custom_domain', 'invalid_main_route', 'invalid_dashboard_settings'].includes(err.message)
  ) {
    res.status(400).json({ error: err.message });
    return;
  }

  // Неизвестная ошибка — server-side лог, минимальный ответ клиенту.
  console.error('[errorHandler] unhandled error:', err);
  res.status(500).json({ error: 'internal_server_error' });
}
