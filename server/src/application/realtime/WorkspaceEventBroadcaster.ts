import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import type { RealtimePublisher } from './RealtimePublisher.js';

// Минимальный порт-ридер участников (структурно совместим с WorkspaceRepository).
type MembersReader = {
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
};

type Deps = {
  readonly members: MembersReader;
  readonly publisher: RealtimePublisher;
};

// Транслирует лёгкое событие чата всем участникам пространства (по их userId) — чтобы их
// открытые вкладки обновили бейдж непрочитанного. Зеркало ProjectEventBroadcaster, но по
// участникам пространства. Best-effort: ошибка резолва не должна влиять на отправку сообщения.
export class WorkspaceEventBroadcaster {
  constructor(private readonly deps: Deps) {}

  async broadcastChatChanged(workspaceId: string): Promise<void> {
    const members = await this.deps.members.listMembers(workspaceId);
    for (const m of members) {
      this.deps.publisher.publish(m.userId, { kind: 'workspace_chat_changed', workspaceId });
    }
  }
}
