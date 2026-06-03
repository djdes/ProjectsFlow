import type { UserRepository } from '../user/UserRepository.js';
import type { AgentTokenRepository } from '../agent/AgentTokenRepository.js';
import { pickDefaultDispatcherUserId } from '../project/pickDefaultDispatcher.js';

export type ResolveDefaultAiDispatcherDeps = {
  /** Нормализованный (trim + lowercase) AI_PROMPT_DEFAULT_DISPATCHER_EMAIL; '' если не задан. */
  readonly email: string;
  readonly users: UserRepository;
  readonly agentTokens: AgentTokenRepository;
};

/**
 * Резолвит дефолтного диспетчера для Inbox AI-prompt-джобов (project_id IS NULL).
 *
 * Порядок:
 *   1. Явный email из AI_PROMPT_DEFAULT_DISPATCHER_EMAIL — но ТОЛЬКО если у этого юзера
 *      есть активный agent-токен. Иначе job создастся, но ни один воркер его не заклеймит
 *      (ListPendingAiPromptJobs скоупится по dispatcher_user_id) → 50с-таймаут в UI.
 *   2. Фоллбэк: первый админ с активным токеном (дежурный Ralph-диспетчер). Покрывает
 *      случаи «env не задан» И «env указывает на несуществующего юзера / юзера без токена».
 *
 * Этот фоллбэк — причина, по которой кнопка «AI» для Inbox-задач работает «из коробки»,
 * пока в системе есть хоть один админ с активным agent-токеном, даже без явного env.
 *
 * @returns userId диспетчера или null, если в системе нет ни одного админа с активным токеном.
 */
export async function resolveDefaultAiDispatcher(
  deps: ResolveDefaultAiDispatcherDeps,
): Promise<string | null> {
  if (deps.email) {
    const user = await deps.users.getByEmail(deps.email);
    if (user && (await deps.agentTokens.countActiveByUser(user.id)) > 0) {
      return user.id;
    }
  }
  return pickDefaultDispatcherUserId(deps.users, deps.agentTokens);
}
