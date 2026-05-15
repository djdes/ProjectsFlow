import type { Session } from '../../domain/session/Session.js';

export type CreateSessionInput = {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
};

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<Session>;
  getById(id: string): Promise<Session | null>;
  delete(id: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
  deleteExpired(): Promise<number>;
}
