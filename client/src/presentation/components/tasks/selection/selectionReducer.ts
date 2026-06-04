// Чистая логика мультивыделения карточек Kanban (Telegram/WhatsApp-стиль).
// Оперирует ТОЛЬКО строковыми id и Set'ами — без React/DOM/domain-импортов,
// поэтому тривиально проверяется в изоляции (см. throwaway-проверку в PR).

export type SelectModifiers = {
  // Shift — выбрать диапазон от якоря до кликнутой включительно (объединяя с текущим).
  readonly shift: boolean;
  // Ctrl/Cmd — точечное добавление/снятие. В режиме выделения == обычный тогл.
  readonly meta: boolean;
};

// Инвертировать одну карточку в выборе.
export function toggleSelection(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// Выбрать диапазон [anchor..id] включительно в визуальном порядке orderedIds,
// объединить с текущим выбором. Если якорь или id вне списка — деградируем до тогла.
export function rangeSelection(
  prev: ReadonlySet<string>,
  orderedIds: readonly string[],
  anchorId: string,
  id: string,
): Set<string> {
  const a = orderedIds.indexOf(anchorId);
  const b = orderedIds.indexOf(id);
  if (a === -1 || b === -1) return toggleSelection(prev, id);
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  const next = new Set(prev);
  for (let i = lo; i <= hi; i++) {
    const cur = orderedIds[i];
    if (cur !== undefined) next.add(cur);
  }
  return next;
}

// Главный редьюсер: следующее множество по клику с модификаторами.
// anchorId — последняя кликнутая без shift карточка (якорь диапазона).
export function nextSelection(
  prev: ReadonlySet<string>,
  id: string,
  mods: SelectModifiers,
  orderedIds: readonly string[],
  anchorId: string | null,
): Set<string> {
  if (mods.shift && anchorId !== null && anchorId !== id) {
    return rangeSelection(prev, orderedIds, anchorId, id);
  }
  return toggleSelection(prev, id);
}

// Якорь после клика: при shift с существующим якорем — не двигаем; иначе — кликнутая.
export function nextAnchor(
  id: string,
  mods: SelectModifiers,
  anchorId: string | null,
): string {
  if (mods.shift && anchorId !== null) return anchorId;
  return id;
}

export function selectAll(orderedIds: readonly string[]): Set<string> {
  return new Set(orderedIds);
}

export function selectNone(): Set<string> {
  return new Set();
}
