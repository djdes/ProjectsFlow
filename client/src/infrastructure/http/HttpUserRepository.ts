import type { User } from '@/domain/user/User';
import type {
  UpdateProfileInput,
  UserRepository,
} from '@/application/user/UserRepository';
import { HttpError, httpClient } from './httpClient';

type UserDto = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
  createdAt: string;
};

function fromDto(dto: UserDto): User {
  return {
    id: dto.id,
    email: dto.email,
    displayName: dto.displayName,
    avatarUrl: dto.avatarUrl,
    isAdmin: dto.isAdmin ?? false,
  };
}

export class HttpUserRepository implements UserRepository {
  async getCurrent(): Promise<User> {
    const { user } = await httpClient.get<{ user: UserDto }>('/auth/me');
    return fromDto(user);
  }

  async updateProfile(input: UpdateProfileInput): Promise<User> {
    const { user } = await httpClient.patch<{ user: UserDto }>('/auth/me', input);
    return fromDto(user);
  }
}

// Утилита экспортируется чтобы AuthProvider мог достучаться к 401 без двойного дублирования
export { HttpError };
