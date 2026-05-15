import type { User } from '@/domain/user/User';

export type UpdateProfileInput = {
  readonly displayName: string;
  readonly email: string;
};

export interface UserRepository {
  getCurrent(): Promise<User>;
  updateProfile(input: UpdateProfileInput): Promise<User>;
}
