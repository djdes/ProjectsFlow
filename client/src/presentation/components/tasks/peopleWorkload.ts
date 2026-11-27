// Workload from the inbox projections, independent of the current view's filters.
export type PersonWorkload = {
  readonly total: number;
  readonly late: number;
  readonly today: number;
};

type WorkloadTask = {
  readonly id: string;
  readonly status: string;
  readonly deadline?: string | null;
  readonly assignee: { readonly userId: string };
};

// Сданная на утверждение работа исполнителя уже не держит: её решает руководитель.
const CLOSED = new Set(['done', 'pending_approval']);

export function peopleWorkload(
  tasks: readonly WorkloadTask[],
  today: string,
): ReadonlyMap<string, PersonWorkload> {
  const seen = new Set<string>();
  const byUser = new Map<string, { total: number; late: number; today: number }>();
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    if (CLOSED.has(task.status)) continue;
    const entry = byUser.get(task.assignee.userId) ?? { total: 0, late: 0, today: 0 };
    entry.total += 1;
    if (task.deadline && task.deadline < today) entry.late += 1;
    else if (task.deadline === today) entry.today += 1;
    byUser.set(task.assignee.userId, entry);
  }
  return byUser;
}

export function workloadLabel(load: PersonWorkload | undefined): string {
  const parts = [`В работе и в очереди: ${load?.total ?? 0}`];
  if (load && load.late > 0) parts.push(`просрочено ${load.late}`);
  if (load && load.today > 0) parts.push(`на сегодня ${load.today}`);
  return parts.join(', ');
}
