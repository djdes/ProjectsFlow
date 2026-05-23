import type { AgentTokenRepository } from '../agent/AgentTokenRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

// Возвращает userId первого админа, у которого ≥1 активный agent-токен — это
// «дежурный» Ralph-диспетчер по умолчанию для новых проектов. Если ни одного
// подходящего админа нет — null (проект остаётся в ручном режиме).
//
// «Первый» определяется порядком, в котором их возвращает users.listAdmins()
// (обычно — по createdAt asc; для единственного админ@projectsflow.ru это
// неважно). Если позже нужна детерминированная политика (например, по
// email-domain или по конкретному id из env) — добавим конфиг.
export async function pickDefaultDispatcherUserId(
  users: UserRepository,
  agentTokens: AgentTokenRepository,
): Promise<string | null> {
  const admins = await users.listAdmins();
  for (const a of admins) {
    const count = await agentTokens.countActiveByUser(a.id);
    if (count > 0) return a.id;
  }
  return null;
}
