import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { users, type UserRow } from '../db/schema.js';
import type { User, UserWithSecrets } from '../../domain/user/User.js';
import type {
  CreateUserInput,
  UpdateProfileInput,
  UserRepository,
} from '../../application/user/UserRepository.js';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt,
  };
}

function toUserWithSecrets(row: UserRow): UserWithSecrets {
  return {
    ...toUser(row),
    passwordHash: row.passwordHash,
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async getById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async getByEmail(email: string): Promise<UserWithSecrets | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    const row = rows[0];
    return row ? toUserWithSecrets(row) : null;
  }

  async create(input: CreateUserInput): Promise<User> {
    await this.db.insert(users).values({
      id: input.id,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      avatarUrl: null,
    });
    // Читаем обратно, чтобы взять реальный createdAt из БД
    const fresh = await this.getById(input.id);
    if (!fresh) throw new Error('Failed to read back user after insert');
    return fresh;
  }

  async updateProfile(id: string, input: UpdateProfileInput): Promise<User> {
    await this.db
      .update(users)
      .set({
        displayName: input.displayName,
        email: input.email.toLowerCase(),
      })
      .where(eq(users.id, id));
    const updated = await this.getById(id);
    if (!updated) throw new Error('User disappeared during updateProfile');
    return updated;
  }
}
