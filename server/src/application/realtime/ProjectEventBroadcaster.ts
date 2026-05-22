import type { RealtimeEvent } from '../../domain/realtime/RealtimeEvent.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { RealtimePublisher } from './RealtimePublisher.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly publisher: RealtimePublisher;
};

// Транслирует доменное событие проекта всем его участникам (по их userId). Так чужие
// вкладки/сессии узнают об изменении и рефетчат данные. Best-effort: ошибки резолва
// участников не должны влиять на основной запрос (вызывающий код глотает reject).
export class ProjectEventBroadcaster {
  constructor(private readonly deps: Deps) {}

  async broadcast(projectId: string, kind: RealtimeEvent['kind']): Promise<void> {
    const members = await this.deps.members.listByProject(projectId);
    for (const m of members) {
      this.deps.publisher.publish(m.userId, { kind, projectId } as RealtimeEvent);
    }
  }
}
