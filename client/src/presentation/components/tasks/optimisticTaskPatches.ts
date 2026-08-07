import type { TaskStatus } from '@/domain/task/Task';

/**
 * Оптимистичные правки карточек «Входящих» — то, что пользователь уже увидел, но сервер
 * ещё не подтвердил.
 *
 * Зачем: удаление и перенос на полки («На утверждении», «Вручную») ждали ответ сервера, а
 * следом ещё `refresh()` (три GET'а) — карточка оставалась на месте секунду и больше, и
 * жест выглядел как «не сработало». Приёмка («Принять») эту болезнь уже вылечила локальным
 * состоянием; здесь тот же приём, но общий для всех трёх действий.
 *
 * `hidden` — карточки нет вовсе (удаление), `status` — карточка сразу переехала в целевую
 * колонку/полку. Правка живёт до тех пор, пока сервер не подтвердит её (см. settledPatchIds)
 * или пока действие не упадёт — тогда вызывающий снимает её сам и показывает тост.
 */
export type OptimisticPatch =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'status'; readonly status: TaskStatus };

export type PatchMap = ReadonlyMap<string, OptimisticPatch>;

type HasIdAndStatus = { readonly id: string; readonly status: TaskStatus };

// Наложить правки на список: скрытые выкинуть, статус подменить.
export function applyPatches<T extends HasIdAndStatus>(
  list: readonly T[],
  patches: PatchMap,
): T[] {
  if (patches.size === 0) return list as T[];
  const out: T[] = [];
  for (const item of list) {
    const patch = patches.get(item.id);
    if (patch === undefined) {
      out.push(item);
      continue;
    }
    if (patch.kind === 'hidden') continue;
    out.push(patch.status === item.status ? item : { ...item, status: patch.status });
  }
  return out;
}

/**
 * Правки, которые уже не нужны: сервер прислал ровно то, что мы показали.
 *
 * Снимать их обязательно, иначе оверрайд навсегда затеняет реальный статус и маскирует
 * чужие изменения (та же ловушка, что в InboxCheckbox с его `optimistic`-стейтом).
 *
 * `hidden` считается отработавшей, когда задачи в живых данных больше нет. `status` — когда
 * статус совпал. Правка на задачу, которой в списке нет вовсе (например, она уехала в
 * проект, не входящий в выборку), тоже снимается: держать её незачем.
 */
export function settledPatchIds(
  patches: PatchMap,
  live: readonly HasIdAndStatus[],
): string[] {
  if (patches.size === 0) return [];
  const liveStatusById = new Map(live.map((t) => [t.id, t.status]));
  const settled: string[] = [];
  for (const [id, patch] of patches) {
    const liveStatus = liveStatusById.get(id);
    if (patch.kind === 'hidden') {
      if (liveStatus === undefined) settled.push(id);
      continue;
    }
    if (liveStatus === undefined || liveStatus === patch.status) settled.push(id);
  }
  return settled;
}

// Иммутабельные помощники: React-стейт нельзя мутировать на месте.
export function withPatch(patches: PatchMap, id: string, patch: OptimisticPatch): PatchMap {
  const next = new Map(patches);
  next.set(id, patch);
  return next;
}

export function withoutPatches(patches: PatchMap, ids: readonly string[]): PatchMap {
  if (ids.length === 0) return patches;
  const next = new Map(patches);
  let removed = false;
  for (const id of ids) removed = next.delete(id) || removed;
  return removed ? next : patches;
}
