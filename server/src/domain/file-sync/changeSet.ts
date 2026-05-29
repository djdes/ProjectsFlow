import { type ManifestEntry, manifestToMap } from './manifest.js';

export type ChangeOp =
  | {
      readonly op: 'add';
      readonly path: string;
      readonly headSha: string | null;
      readonly mode: number;
      readonly size: number;
      readonly isSymlink: boolean;
      readonly symlinkTarget?: string | null;
    }
  | {
      readonly op: 'modify';
      readonly path: string;
      readonly baseSha: string | null;
      readonly headSha: string | null;
      readonly mode: number;
      readonly size: number;
      readonly isSymlink: boolean;
      readonly symlinkTarget?: string | null;
    }
  | {
      readonly op: 'delete';
      readonly path: string;
      readonly baseSha: string | null;
    };

function token(e: ManifestEntry): string {
  if (e.isSymlink) return `symlink:${e.symlinkTarget ?? ''}`;
  return e.sha256 ?? '';
}

// Дифф base->head. ВАЖНО (data-loss-safe): этот дифф — чистая теоретико-множественная операция.
// Безопасность от потери данных обеспечивается ВЫЗЫВАЮЩЕЙ стороной: диспетчер диффит свой post-run
// обход против базы, КОТОРУЮ САМ материализовал из того же манифеста, поэтому ignore-set идентичен
// по построению, и любой не-материализованный путь в head не появится → не будет ложного delete.
// Сервер дополнительно сверяет ignore_set_hash(base) === ignore_set_hash(result) (см. RecordSnapshotResult).
export function diffManifests(
  base: readonly ManifestEntry[],
  head: readonly ManifestEntry[],
): ChangeOp[] {
  const baseMap = manifestToMap(base);
  const headMap = manifestToMap(head);
  const ops: ChangeOp[] = [];

  for (const [path, h] of headMap) {
    const b = baseMap.get(path);
    if (!b) {
      ops.push({
        op: 'add',
        path,
        headSha: h.sha256 ?? null,
        mode: h.mode,
        size: h.size,
        isSymlink: !!h.isSymlink,
        symlinkTarget: h.symlinkTarget ?? null,
      });
    } else if (token(b) !== token(h) || b.mode !== h.mode) {
      ops.push({
        op: 'modify',
        path,
        baseSha: b.sha256 ?? null,
        headSha: h.sha256 ?? null,
        mode: h.mode,
        size: h.size,
        isSymlink: !!h.isSymlink,
        symlinkTarget: h.symlinkTarget ?? null,
      });
    }
  }

  for (const [path, b] of baseMap) {
    if (!headMap.has(path)) {
      ops.push({ op: 'delete', path, baseSha: b.sha256 ?? null });
    }
  }

  return ops;
}

export type ChangeSetCounts = { added: number; modified: number; deleted: number };

export function countChanges(ops: readonly ChangeOp[]): ChangeSetCounts {
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const o of ops) {
    if (o.op === 'add') added++;
    else if (o.op === 'modify') modified++;
    else deleted++;
  }
  return { added, modified, deleted };
}

// Эталонный 3-way конфликт-резолвер (спецификация для .NET-клиента; используется в CLI-тестах).
// B = base sha (op.baseSha), D = новый sha диспетчера (op.headSha), L = текущий локальный sha.
// Принцип never-clobber: локальные правки пользователя НИКОГДА не перезаписываются молча.
export type ApplyAction = 'apply' | 'keep-local' | 'noop' | 'delete-local' | 'conflict';

export function resolveConflict(op: ChangeOp, localSha: string | null): ApplyAction {
  if (op.op === 'delete') {
    if (localSha === op.baseSha) return 'delete-local'; // в .pf-trash, восстановимо
    if (localSha === null) return 'noop'; // уже удалён локально
    return 'conflict'; // юзер правил файл, который Ralph удалил
  }

  const D = op.headSha;
  const B = op.op === 'modify' ? op.baseSha : null; // add: база отсутствовала

  if (op.op === 'add') {
    if (localSha === null) return 'apply'; // нет локально → создаём
    if (localSha === D) return 'noop'; // уже совпадает
    return 'conflict'; // локально есть другой файл по тому же пути
  }

  // modify
  if (localSha === B) return 'apply'; // безопасный fast-forward
  if (localSha === D) return 'noop'; // сошлись
  if (localSha === null) return 'conflict'; // юзер удалил файл, который Ralph менял
  return 'conflict'; // обе стороны разошлись от базы
}
