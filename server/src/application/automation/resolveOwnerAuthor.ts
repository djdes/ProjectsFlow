import type { GitAuthorMode } from '../../domain/automation/Automation.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { ResolvedGitAuthor } from './automationView.js';

// Резолв идентичности владельца проекта для gitAuthorMode='owner' (иначе undefined —
// buildDispatcherView подставит null/null или значения из конфига). Общий для обоих
// dispatcher-use-case'ов (GetAutomationForDispatcher / RecordAutomationTask).
export async function resolveOwnerAuthor(
  users: UserRepository,
  ownerId: string,
  mode: GitAuthorMode,
): Promise<ResolvedGitAuthor | undefined> {
  if (mode !== 'owner') return undefined;
  const owner = await users.getById(ownerId);
  return { name: owner?.displayName ?? null, email: owner?.email ?? null };
}
