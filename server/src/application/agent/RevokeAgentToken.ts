import { AgentTokenNotFoundError } from '../../domain/agent/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { AgentTokenRepository } from './AgentTokenRepository.js';

type Deps = {
  readonly tokens: AgentTokenRepository;
  readonly projects: ProjectRepository;
};

export class RevokeAgentToken {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, tokenId: string): Promise<void> {
    const ok = await this.deps.tokens.revoke(tokenId, userId);
    if (!ok) throw new AgentTokenNotFoundError();
    // Если это был ПОСЛЕДНИЙ активный токен юзера — он перестал быть ralph-capable,
    // снимаем его с роли диспетчера во всех проектах. Иначе у проектов остался бы
    // диспетчер без работающего MCP — никто не выполняет задачи, юзер этого не видит.
    //
    // Token-repo и project-repo — разные агрегаты, общую TX через application-layer
    // не пропустишь без серьёзного рефактора. Пишем clearDispatcher как best-effort:
    // если он упадёт, revoke всё равно прошёл (юзер ожидаемо больше не сможет работать).
    // Логируем, чтобы расхождение было видно.
    const remaining = await this.deps.tokens.countActiveByUser(userId);
    if (remaining === 0) {
      try {
        await this.deps.projects.clearDispatcherForUser(userId);
      } catch (e) {
        console.error(
          `[RevokeAgentToken] clearDispatcherForUser(${userId}) failed after token revoke:`,
          (e as Error).message,
        );
        // Не пробрасываем — token revoke успешен, dispatcher-cleanup можно докрутить
        // отложенно (TODO: cron-задача "снять диспетчера у юзеров без active tokens").
      }
    }
  }
}
