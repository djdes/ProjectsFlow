import type { InboxBlockTask } from '../inboxBlockTasks';
import { selectBoardTasks } from '../inboxBlockTasks';
import { dueKindOf, type DueKind } from '../assignedGrouping';

// Counters and cards share the same universe. On mobile only one section is visible;
// on desktop both are. Approval tasks participate in the same date filter as other cards.
export function selectInboxView(input: {
  tasks: readonly InboxBlockTask[];
  approvals: readonly InboxBlockTask[];
  today: string;
  due: DueKind | null;
  section: 'now' | 'queue' | null;
  wide: boolean;
}) {
  const manual = input.tasks.filter((task) => task.status === 'manual');
  const queue = selectBoardTasks(input.tasks);
  const now = [...input.approvals, ...manual];
  // Decide the initial section before filtering; selecting a chip must never move tabs.
  const section = input.section ?? (now.length === 0 && queue.length > 0 ? 'queue' : 'now');
  const countSource = input.wide ? [...now, ...queue] : section === 'now' ? now : queue;
  const dueCounts = { late: 0, today: 0, none: 0 };
  const seen = new Set<string>();
  for (const task of countSource) {
    if (task.status === 'done' || seen.has(task.id)) continue;
    seen.add(task.id);
    const kind = dueKindOf(task.deadline, input.today);
    if (kind !== 'future') dueCounts[kind] += 1;
  }
  const matches = (task: InboxBlockTask) => input.due === null
    || (task.status !== 'done' && dueKindOf(task.deadline, input.today) === input.due);
  return {
    section,
    dueCounts,
    manual: manual.filter(matches),
    approvals: input.approvals.filter(matches),
    queue: queue.filter(matches),
  };
}
