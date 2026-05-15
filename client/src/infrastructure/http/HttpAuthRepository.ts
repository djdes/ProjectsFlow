import type { User } from '@/domain/user/User';
import {
  InvalidCredentialsError,
  UserEmailAlreadyExistsError,
} from '@/domain/user/errors';
import type {
  AuthRepository,
  LoginInput,
  RegisterInput,
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
  async register(input: RegisterInput): Promise<User> {
    try {
      const { user } = await httpClient.post<{ user: UserDto }>('/auth/register', input);
      return fromDto(user);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        throw new UserEmailAlreadyExistsError(input.email);
      }
      throw err;
    }
  }

  async login(input: LoginInput): Promise<User> {
    try {
      const { user } = await httpClient.post<{ user: UserDto }>('/auth/login', input);
      return fromDto(user);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        throw new InvalidCredentialsError();
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
