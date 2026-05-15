import type { SessionRepository } from '../session/SessionRepository.js';

export class Logout {
  constructor(private readonly sessions: SessionRepository) {}

  execute(sessionId: string): Promise<void> {
    return this.sessions.delete(sessionId);
  }
}
