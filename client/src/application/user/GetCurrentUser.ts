import type { User } from '@/domain/user/User';
import type { UserRepository } from './UserRepository';

export class GetCurrentUser {
  constructor(private readonly repo: UserRepository) {}

  execute(): Promise<User> {
    return this.repo.getCurrent();
  }
}
