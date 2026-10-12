import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { NotificationRepository } from './NotificationRepository.js';

type Deps = {
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly repo: NotificationRepository;
  readonly now: () => Date;
};

export class MarkNotificationRead {
  constructor(private readonly deps: Deps) {}

  // Возвращает true если действительно что-то поменяли (запись существовала и не была прочитана).
  // 404 на не-found UI клиенту не показывает — просто молча скипает (соответствует idempotent UX'у).
  async execute(notificationId: string, userId: string): Promise<boolean> {
    const workspace = await this.deps.resolveActiveWorkspace(userId);
    if (!workspace) return false;
    return this.deps.repo.markRead(notificationId, userId, this.deps.now(), workspace.id);
  }
}
