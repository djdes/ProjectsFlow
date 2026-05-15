import type { User } from '../../domain/user/User.js';
import { UserEmailAlreadyExistsError, UserNotFoundError } from '../../domain/user/errors.js';
import type { UpdateProfileInput, UserRepository } from './UserRepository.js';

export class UpdateProfile {
  constructor(private readonly users: UserRepository) {}

  async execute(userId: string, input: UpdateProfileInput): Promise<User> {
    const next: UpdateProfileInput = {
      displayName: input.displayName.trim(),
      email: input.email.trim().toLowerCase(),
    };

    // Если email меняется и уже занят другим user'ом — 409
    const taker = await this.users.getByEmail(next.email);
    if (taker && taker.id !== userId) throw new UserEmailAlreadyExistsError(next.email);

    const updated = await this.users.updateProfile(userId, next);
    if (!updated) throw new UserNotFoundError();
    return updated;
  }
}
