import type { CheckBudget } from './CheckBudget.js';
import type { TaskDelegationRepository } from '../task/TaskDelegationRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';

export type DispatchAllowedReason = 'ok' | 'plan_required' | 'budget_exceeded';

export type DispatchAllowedResult = {
  readonly allowed: boolean;
  readonly reason: DispatchAllowedReason;
  // Инициатор (делегатор задачи), по чьему тарифу принято решение. null — не резолвится.
  readonly billedUserId: string | null;
};

type Deps = {
  readonly tasks: TaskRepository;
  readonly taskDelegations: TaskDelegationRepository;
  readonly checkBudget?: CheckBudget;
};

// НЕ-бросающая проверка «можно ли диспетчеру запускать воркер по этой задаче». Резолвит
// инициатора (делегатора) и смотрит его тариф/бюджет. Диспетчер зовёт её ПЕРЕД запуском
// claude -p и пропускает задачу, если !allowed (оставляет в очереди до отката окна / апгрейда).
// Это единственная точка enforcement воркера: у kanban-воркера нет серверного claim, диспетчер
// сам выбирает todo-задачу и тратит подписку локально — поэтому гейт ДО запуска, здесь.
// Инициатор не резолвится ИЛИ фича не сконфигурирована → allow (fallback, как в остальных гейтах).
export class CheckDispatchAllowed {
  constructor(private readonly deps: Deps) {}

  async execute(taskId: string): Promise<DispatchAllowedResult> {
    const task = await this.deps.tasks.getById(taskId);
    const delegation = await this.deps.taskDelegations.findActiveForTask(taskId);
    const billedUserId = task?.createdBy ?? delegation?.creatorUserId ?? null;
    if (!billedUserId || !this.deps.checkBudget) {
      return { allowed: true, reason: 'ok', billedUserId };
    }
    const { allowed, summary } = await this.deps.checkBudget.execute(billedUserId);
    if (summary.isAdmin) return { allowed: true, reason: 'ok', billedUserId };
    if (summary.plan === 'free') return { allowed: false, reason: 'plan_required', billedUserId };
    if (!allowed) return { allowed: false, reason: 'budget_exceeded', billedUserId };
    return { allowed: true, reason: 'ok', billedUserId };
  }
}
