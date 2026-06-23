import type { User } from '../../domain/user/User.js';
import { UserEmailAlreadyExistsError } from '../../domain/user/errors.js';
import type { Session } from '../../domain/session/Session.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { SessionRepository } from '../session/SessionRepository.js';
import type { PasswordHasher } from '../crypto/PasswordHasher.js';

export type RegisterInput = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
};

export type AuthResult = {
  readonly user: User;
  readonly session: Session;
};

type Deps = {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly passwordHasher: PasswordHasher;
  readonly idGen: () => string;
  readonly sessionTtlMs: number;
  readonly now: () => Date;
  // Создаёт личное пространство новому юзеру и делает его активным. Без пространства
  // юзер не сможет создавать проекты (projects.workspace_id NOT NULL).
  readonly createDefaultWorkspace: (userId: string) => Promise<void>;
};

export class Register {
  constructor(private readonly deps: Deps) {}

  async execute(input: RegisterInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.deps.users.getByEmail(email);
    if (existing) throw new UserEmailAlreadyExistsError(email);

    const passwordHash = await this.deps.passwordHasher.hash(input.password);
    const user = await this.deps.users.create({
      id: this.deps.idGen(),
      email,
      passwordHash,
      displayName: input.displayName.trim(),
    });

    // Личное пространство по умолчанию + ставим активным. До этого юзер не сможет
    // создать ни одного проекта (workspace_id NOT NULL).
    await this.deps.createDefaultWorkspace(user.id);

    const session = await this.deps.sessions.create({
      id: this.deps.idGen(),
      userId: user.id,
      expiresAt: new Date(this.deps.now().getTime() + this.deps.sessionTtlMs),
    });

    return { user, session };
  }
}
