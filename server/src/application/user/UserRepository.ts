import type { User, UserWithSecrets } from '../../domain/user/User.js';

export type CreateUserInput = {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string;
};

export type UpdateProfileInput = {
  readonly displayName: string;
  readonly email: string;
};

export interface UserRepository {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<UserWithSecrets | null>;
  create(input: CreateUserInput): Promise<User>;
  updateProfile(id: string, input: UpdateProfileInput): Promise<User>;
}
