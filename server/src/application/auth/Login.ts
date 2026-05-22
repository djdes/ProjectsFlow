import type { User } from '../../domain/user/User.js';
import { InvalidCredentialsError } from '../../domain/user/errors.js';
import type { Session } from '../../domain/session/Session.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { SessionRepository } from '../session/SessionRepository.js';
import type { PasswordHasher } from '../crypto/PasswordHasher.js';
import type { AuthResult } from './Register.js';

export type LoginInput = {
  readonly email: string;
  readonly password: string;
};

type Deps = {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly passwordHasher: PasswordHasher;
  readonly idGen: () => string;
  readonly sessionTtlMs: number;
  readonly now: () => Date;
};

export class Login {
  constructor(private readonly deps: Deps) {}

  async execute(input: LoginInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const candidate = await this.deps.users.getByEmail(email);
    if (!candidate) {
      // Дополнительный hash-verify даже без user — чтобы не утекать существование email через timing.
      await this.deps.passwordHasher.verify(input.password, '$argon2id$v=19$m=65536,t=3,p=4$YWFhYWFhYWFhYWFh$YQ');
      throw new InvalidCredentialsError();
    }

    const ok = await this.deps.passwordHasher.verify(input.password, candidate.passwordHash);
    if (!ok) throw new InvalidCredentialsError();

    const user: User = {
      id: candidate.id,
      email: candidate.email,
      displayName: candidate.displayName,
      avatarUrl: candidate.avatarUrl,
      isAdmin: candidate.isAdmin,
      createdAt: candidate.createdAt,
    };

    const session: Session = await this.deps.sessions.create({
      id: this.deps.idGen(),
      userId: user.id,
      expiresAt: new Date(this.deps.now().getTime() + this.deps.sessionTtlMs),
    });

    return { user, session };
  }
}
