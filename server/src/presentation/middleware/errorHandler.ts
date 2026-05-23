import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  InvalidCredentialsError,
  UserEmailAlreadyExistsError,
  UserNotFoundError,
} from '../../domain/user/errors.js';
import {
  CannotDeleteInboxError,
  CannotInviteToInboxError,
  CannotRemoveSelfAsLastOwnerError,
  InsufficientProjectRoleError,
  ProjectInviteAlreadyUsedError,
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
  ProjectNameAlreadyExistsError,
  ProjectNameEmptyError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import {
  GithubApiError,
  GithubIntegrationDisabledError,
  GithubNotConnectedError,
  GithubRepoUrlInvalidError,
} from '../../domain/github/errors.js';
import {
  SecretKeyInvalidError,
  SecretNotFoundError,
} from '../../domain/secrets/errors.js';
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
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import {
  AgentDeviceCodeAlreadyApprovedError,
  AgentDeviceCodeConsumedError,
  AgentDeviceCodeDeniedError,
  AgentDeviceCodeExpiredError,
  AgentDeviceCodeNotFoundError,
  AgentDeviceCodePendingError,
  AgentJobAlreadyClaimedError,
  AgentJobNotCancellableError,
  AgentJobNotFoundError,
  AgentJobNotInRunningStateError,
  AgentTokenInvalidError,
  AgentTokenNameEmptyError,
  AgentTokenNotFoundError,
  RequestTargetStaleError,
  TaskAlreadyHasActiveAgentJobError,
  TaskMissingDescriptionError,
} from '../../domain/agent/errors.js';
import {
  AssignmentNotFoundError,
  EmployeeNotFoundError,
  FinanceValidationError,
} from '../../domain/finance/errors.js';

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
    res.status(400).json({
      error: 'bad_request',
      message: 'Validation failed',
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

  if (err instanceof AgentJobNotFoundError) {
    res.status(404).json({ error: 'agent_job_not_found', message: err.message });
    return;
  }
  if (err instanceof AgentJobNotCancellableError) {
    res.status(409).json({ error: 'agent_job_not_cancellable', message: err.message });
    return;
  }
  if (err instanceof AgentJobAlreadyClaimedError) {
    res.status(409).json({ error: 'agent_job_already_claimed', message: err.message });
    return;
  }
  if (err instanceof AgentJobNotInRunningStateError) {
    res.status(409).json({ error: 'agent_job_not_in_running_state', message: err.message });
    return;
  }
  if (err instanceof TaskAlreadyHasActiveAgentJobError) {
    res.status(409).json({ error: 'task_has_active_agent_job', message: err.message });
    return;
  }
  if (err instanceof TaskMissingDescriptionError) {
    res.status(400).json({ error: 'task_missing_description', message: err.message });
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

  // Неизвестная ошибка — server-side лог, минимальный ответ клиенту.
  console.error('[errorHandler] unhandled error:', err);
  res.status(500).json({ error: 'internal_server_error' });
}
