import type { User } from '@/domain/user/User';
import type { UserRepository, UpdateProfileInput } from '@/application/user/UserRepository';
import { seedUser } from './seed-data';

const LATENCY_MS = 120;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

export class MockUserRepository implements UserRepository {
  private current: User = seedUser;

  getCurrent(): Promise<User> {
    return delay(this.current);
  }

  updateProfile(input: UpdateProfileInput): Promise<User> {
    this.current = { ...this.current, displayName: input.displayName, email: input.email };
    return delay(this.current);
  }
}
