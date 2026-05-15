import type { User } from '@/domain/user/User';

export type RegisterInput = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
};

export type LoginInput = {
  readonly email: string;
  readonly password: string;
};

export interface AuthRepository {
  register(input: RegisterInput): Promise<User>;
  login(input: LoginInput): Promise<User>;
  logout(): Promise<void>;
  getCurrentOrNull(): Promise<User | null>;
}
