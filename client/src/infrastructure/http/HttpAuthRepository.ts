import type { User } from '@/domain/user/User';
import {
  MagicLinkRateLimitedError,
  MagicTokenConsumedError,
  MagicTokenExpiredError,
  MagicTokenInvalidError,
} from '@/domain/user/errors';
import type {
  AuthRepository,
  ConsumeMagicLinkInput,
  RequestMagicLinkInput,
  RequestMagicLinkResult,
} from '@/application/auth/AuthRepository';
import { HttpError, httpClient } from './httpClient';

type UserDto = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
};

function fromDto(dto: UserDto): User {
  return {
    id: dto.id,
    email: dto.email,
    displayName: dto.displayName,
    avatarUrl: dto.avatarUrl,
  };
}

export class HttpAuthRepository implements AuthRepository {
  async requestMagicLink(input: RequestMagicLinkInput): Promise<RequestMagicLinkResult> {
    try {
      const res = await httpClient.post<{ ok: true; devMagicUrl?: string }>(
        '/auth/magic/request',
        input,
      );
      return { devMagicUrl: res.devMagicUrl ?? null };
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        const retryAfter =
          (err.body.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 60;
        throw new MagicLinkRateLimitedError(retryAfter);
      }
      throw err;
    }
  }

  async consumeMagicLink(input: ConsumeMagicLinkInput): Promise<User> {
    try {
      const { user } = await httpClient.post<{ user: UserDto }>('/auth/magic/consume', input);
      return fromDto(user);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.body.error === 'magic_token_invalid') throw new MagicTokenInvalidError();
        if (err.body.error === 'magic_token_expired') throw new MagicTokenExpiredError();
        if (err.body.error === 'magic_token_consumed') throw new MagicTokenConsumedError();
      }
      throw err;
    }
  }

  async logout(): Promise<void> {
    await httpClient.post<void>('/auth/logout');
  }

  async getCurrentOrNull(): Promise<User | null> {
    try {
      const { user } = await httpClient.get<{ user: UserDto }>('/auth/me');
      return fromDto(user);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return null;
      throw err;
    }
  }
}
