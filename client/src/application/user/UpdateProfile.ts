import type { User } from '@/domain/user/User';
import type { UserRepository, UpdateProfileInput } from './UserRepository';

export class UpdateProfile {
  constructor(private readonly repo: UserRepository) {}

  execute(input: UpdateProfileInput): Promise<User> {
    return this.repo.updateProfile(input);
  }
}
