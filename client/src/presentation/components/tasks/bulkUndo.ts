import type { RalphMode, Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { BulkResult, BulkTaskActions } from '@/presentation/hooks/useBulkTaskActions';

// Что было у задачи до массового действия — по этому «Отменить» в тосте возвращает всё
// назад теми же массовыми вызовами (по одному на каждое прежнее значение).
export type BulkTaskSnapshot = {
  readonly status: TaskStatus;
  readonly priority: TaskPriority | null;
  readonly deadline: string | null;
  readonly assigneeUserId: string;
  readonly projectId: string;
  readonly ralphMode: RalphMode;
};

export type BulkUndoKind = 'assign' | 'deadline' | 'priority' | 'column' | 'project' | 'ralph';

// Ids по прежнему значению поля: { prev → [ids] }. Порядок — порядок первого появления.
export function groupByPrevious<V>(
  snapshot: ReadonlyMap<string, BulkTaskSnapshot>,
  pick: (s: BulkTaskSnapshot) => V,
): Map<V, string[]> {
  const groups = new Map<V, string[]>();
  for (const [id, snap] of snapshot) {
    const key = pick(snap);
    const ids = groups.get(key);
    if (ids) ids.push(id);
    else groups.set(key, [id]);
  }
  return groups;
}

// Вернуть набор к снимку: по одному массовому вызову на каждое прежнее значение.
export async function undoBulk(
  kind: BulkUndoKind,
  snapshot: ReadonlyMap<string, BulkTaskSnapshot>,
  bulk: BulkTaskActions,
): Promise<BulkResult> {
  const total: BulkResult = { ok: 0, failed: 0 };
  const add = (r: BulkResult): void => {
    total.ok += r.ok;
    total.failed += r.failed;
  };
  const each = async <V>(pick: (s: BulkTaskSnapshot) => V, run: (ids: string[], value: V) => Promise<BulkResult>) => {
    for (const [value, ids] of groupByPrevious(snapshot, pick)) add(await run(ids, value));
  };
  if (kind === 'assign') await each((s) => s.assigneeUserId, (ids, v) => bulk.assign(ids, v));
  else if (kind === 'deadline') await each((s) => s.deadline, (ids, v) => bulk.setDeadline(ids, v));
  else if (kind === 'priority') await each((s) => s.priority, (ids, v) => bulk.setPriority(ids, v));
  else if (kind === 'column') await each((s) => s.status, (ids, v) => bulk.moveToColumn(ids, v));
  else if (kind === 'project') await each((s) => s.projectId, (ids, v) => bulk.moveToProject(ids, v));
  else await each((s) => s.ralphMode, (ids, v) => bulk.setRalphMode(ids, v));
  return total;
}

// Снимок для BulkActionBar из списков задач экрана (доска проекта, «Входящие»): задача,
// которой в списках нет, в снимок не попадает — её «Отменить» не трогает.
export function bulkSnapshotFrom(
  lists: ReadonlyArray<readonly Task[]>,
): (ids: readonly string[]) => ReadonlyMap<string, BulkTaskSnapshot> {
  return (ids) => {
    const wanted = new Set(ids);
    const out = new Map<string, BulkTaskSnapshot>();
    for (const list of lists) {
      for (const t of list) {
        if (!wanted.has(t.id) || out.has(t.id)) continue;
        out.set(t.id, {
          status: t.status,
          priority: t.priority,
          deadline: t.deadline,
          assigneeUserId: t.assignee.userId,
          projectId: t.projectId,
          ralphMode: t.ralphMode,
        });
      }
    }
    return out;
  };
}
