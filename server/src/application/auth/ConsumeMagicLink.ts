import { createHash } from 'node:crypto';
import {
  MagicTokenConsumedError,
  MagicTokenExpiredError,
  MagicTokenInvalidError,
} from '../../domain/auth/errors.js';
import type { User } from '../../domain/user/User.js';
import type { Session } from '../../domain/session/Session.js';
import type { MagicTokenRepository } from './MagicTokenRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { SessionRepository } from '../session/SessionRepository.js';

export type ConsumeMagicLinkInput = {
  readonly token: string;
};

export type ConsumeMagicLinkResult = {
  readonly user: User;
  readonly session: Session;
};

type Deps = {
  readonly tokens: MagicTokenRepository;
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly idGen: () => string;
  readonly sessionTtlMs: number;
  readonly now: () => Date;
};

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  return local.slice(0, 80);
}

export class ConsumeMagicLink {
  constructor(private readonly deps: Deps) {}

  async execute(input: ConsumeMagicLinkInput): Promise<ConsumeMagicLinkResult> {
    const raw = input.token.trim();
    if (!raw) throw new MagicTokenInvalidError();

    const tokenHash = sha256Hex(raw);
    const token = await this.deps.tokens.findByHash(tokenHash);
    if (!token) throw new MagicTokenInvalidError();

    const now = this.deps.now();
    if (token.consumedAt) throw new MagicTokenConsumedError();
    if (token.expiresAt.getTime() <= now.getTime()) throw new MagicTokenExpiredError();

    let user = await this.deps.users.getByEmail(token.email);
    if (!user) {
      user = await this.deps.users.create({
        id: this.deps.idGen(),
        email: token.email,
        displayName: displayNameFromEmail(token.email),
      });
    }

    await this.deps.tokens.markConsumed(token.id, now);

    const session = await this.deps.sessions.create({
      id: this.deps.idGen(),
      userId: user.id,
      expiresAt: new Date(now.getTime() + this.deps.sessionTtlMs),
    });

    return { user, session };
  }
}
