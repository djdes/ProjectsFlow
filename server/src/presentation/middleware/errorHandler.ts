import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { UserEmailAlreadyExistsError, UserNotFoundError } from '../../domain/user/errors.js';
import {
  MagicLinkRateLimitedError,
  MagicTokenConsumedError,
  MagicTokenExpiredError,
  MagicTokenInvalidError,
} from '../../domain/auth/errors.js';
import {
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
  SecretCipherCorruptedError,
  SecretKeyInvalidError,
  SecretNotFoundError,
  SecretsVaultDisabledError,
} from '../../domain/secrets/errors.js';
import {
  FrontmatterInvalidError,
  KbDocumentNotFoundError,
  KbNotConnectedError,
  KbRepoAlreadyConnectedError,
  KbRepoConflictError,
} from '../../domain/kb/errors.js';

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

  if (err instanceof MagicTokenInvalidError) {
    res.status(400).json({ error: 'magic_token_invalid', message: 'Ссылка недействительна' });
    return;
  }
  if (err instanceof MagicTokenExpiredError) {
    res.status(410).json({ error: 'magic_token_expired', message: 'Срок действия ссылки истёк' });
    return;
  }
  if (err instanceof MagicTokenConsumedError) {
    res.status(410).json({ error: 'magic_token_consumed', message: 'Ссылка уже была использована' });
    return;
  }
  if (err instanceof MagicLinkRateLimitedError) {
    res.status(429).json({
      error: 'magic_link_rate_limited',
      message: 'Слишком много запросов. Подожди и попробуй ещё раз.',
      details: { retryAfterSeconds: err.retryAfterSeconds },
    });
    return;
  }

  if (err instanceof UserNotFoundError) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }

  if (err instanceof UserEmailAlreadyExistsError) {
    res.status(409).json({ error: 'email_taken', message: 'Email уже занят' });
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
  if (err instanceof SecretsVaultDisabledError) {
    res.status(503).json({
      error: 'secrets_vault_disabled',
      message: 'Secrets vault не настроен на сервере (нет SECRETS_MASTER_KEY).',
    });
    return;
  }
  if (err instanceof SecretCipherCorruptedError) {
    console.error('[errorHandler] secret cipher corrupted — master key changed?', err);
    res.status(500).json({ error: 'secret_cipher_corrupted' });
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

  console.error('[errorHandler] unhandled error:', err);
  res.status(500).json({ error: 'internal_server_error' });
}
