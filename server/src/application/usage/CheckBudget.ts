import type { UsageSummary } from '../../domain/usage/UsageSummary.js';
import { PlanRequiredError, UsageBlockedError } from '../../domain/usage/errors.js';
import type { GetUserUsage } from './GetUserUsage.js';

type Deps = {
  readonly getUserUsage: GetUserUsage;
};

// Гейт enforcement: разрешён ли старт новой AI-работы для профиля. free → всегда allowed
// (caps null → isBlocked false), поэтому отдельной ветки «if free» в гейтах не нужно.
export class CheckBudget {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<{ allowed: boolean; summary: UsageSummary }> {
    const summary = await this.deps.getUserUsage.execute(userId);
    return { allowed: !summary.isBlocked, summary };
  }
}

// Хелпер для гейтов claim/start: бросает UsageBlockedError, если подписка исчерпала окно.
// checkBudget undefined → пропускаем (фича не сконфигурирована). free → allowed (внутри execute).
export async function assertBudgetAllowed(
  checkBudget: CheckBudget | undefined,
  userId: string,
): Promise<void> {
  if (!checkBudget) return;
  const { allowed, summary } = await checkBudget.execute(userId);
  if (allowed) return;
  const w = summary.blockedWindow ?? '7d';
  const win = w === '5h' ? summary.fiveHour : summary.sevenDay;
  throw new UsageBlockedError(w, win.resetsAt);
}

// Гейт доступа к диспетчеру для КОНКРЕТНОГО инициатора работы (кто нажал/делегировал).
// free → PlanRequiredError (нет доступа к диспетчеру вовсе), исчерпал окно → UsageBlockedError.
// Один вызов GetUserUsage покрывает обе проверки. undefined checkBudget → пропускаем (фича off).
export async function assertDispatcherAllowed(
  checkBudget: CheckBudget | undefined,
  userId: string,
): Promise<void> {
  if (!checkBudget) return;
  const { allowed, summary } = await checkBudget.execute(userId);
  if (summary.isAdmin) return; // админ/владелец — безлимитный доступ к диспетчеру
  if (summary.plan === 'free') throw new PlanRequiredError();
  if (allowed) return;
  const w = summary.blockedWindow ?? '7d';
  const win = w === '5h' ? summary.fiveHour : summary.sevenDay;
  throw new UsageBlockedError(w, win.resetsAt);
}
