// Загрузка участника для ленты «кто»: сколько его незакрытых задач горит — просрочено и на
// сегодня. Считается из уже загруженных задач блока (свои + «Все» + личные доски коллег),
// без отдельного запроса: при перетаскивании видно, кому задачу отдать, а кому — нет.
export type PersonWorkload = {
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
  const byUser = new Map<string, { late: number; today: number }>();
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    if (CLOSED.has(task.status) || !task.deadline || task.deadline > today) continue;
    const entry = byUser.get(task.assignee.userId) ?? { late: 0, today: 0 };
    if (task.deadline < today) entry.late += 1;
    else entry.today += 1;
    byUser.set(task.assignee.userId, entry);
  }
  return byUser;
}

// Подпись для aria-label/подсказки: «просрочено 2, на сегодня 1».
export function workloadLabel(load: PersonWorkload | undefined): string | null {
  if (!load || load.late + load.today === 0) return null;
  const parts: string[] = [];
  if (load.late > 0) parts.push(`просрочено ${load.late}`);
  if (load.today > 0) parts.push(`на сегодня ${load.today}`);
  return parts.join(', ');
}
