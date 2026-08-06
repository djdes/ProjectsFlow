import { useEffect, useRef, useState } from 'react';

// Чистая функция реконсиляции порядка id (тестируется без React/DOM): добавляет в конец
// prevOrder только те id из nextIds, которых там ещё нет. id, пропавшие из nextIds
// («призраки» на схлопывании), НЕ убираются здесь — их убирает вызывающий хук по
// собственному таймеру, когда доиграет анимация конкретного элемента.
export function mergeOrderedIds(prevOrder: readonly string[], nextIds: readonly string[]): string[] {
  const appended = nextIds.filter((id) => !prevOrder.includes(id));
  if (appended.length === 0) return prevOrder as string[];
  return [...prevOrder, ...appended];
}

export type ExitingListEntry<T> = {
  item: T;
  // true — элемента уже нет в текущем `items`, он держится в DOM только на время
  // CSS-коллапса. Вызывающий применяет схлопывающие стили и не должен запускать
  // на нём никакие сетевые мутации.
  exiting: boolean;
};

// Полки «На утверждении»/«В работе» (AssignedToMeBlock) и группы-колонки «Входящих»
// (assignedGrouping.ts) сегодня выбрасывают карточку/колонку из массива МГНОВЕННО, как
// только она пропадает из исходных данных (принята/удалена/группа опустела) — соседи
// прыгают на её место без анимации. Хук держит такой элемент отрисованным ещё `ms`
// (в позиции, где он и был), помечая его exiting:true, — вызывающий за это время
// проигрывает CSS-коллапс (grid-template-columns/rows → 0fr), а не framer-layout (тот
// на тач осознанно отключён, см. KanbanCard.IS_COARSE_POINTER).
//
// Порядок id и содержимое живут в React-состоянии (не в refs): чтение `.current` во время
// рендера запрещено правилом react-hooks/refs («Cannot access refs during render») —
// таймеры коллапса единственное, что законно живёт в ref (их читают/пишут только внутри
// эффектов/колбэков, никогда в теле рендера).
export function useExitingListItems<T>(
  items: readonly T[],
  getId: (item: T) => string,
  ms: number,
): ExitingListEntry<T>[] {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => items.map(getId));
  const [itemById, setItemById] = useState<Map<string, T>>(
    () => new Map(items.map((it) => [getId(it), it])),
  );
  const timersRef = useRef(new Map<string, number>());

  useEffect(() => {
    const nextIds = items.map(getId);
    const nextIdSet = new Set(nextIds);

    // Свежее содержимое живых id (призраков не трогаем — их последний вид уже сохранён).
    setItemById((prev) => {
      const next = new Map(prev);
      for (const it of items) next.set(getId(it), it);
      return next;
    });

    setOrderedIds((prev) => {
      // orderedIds ДО merge — ровно то, что уже отрисовано; именно среди него ищем id,
      // только что пропавшие из nextIds, чтобы завести таймер их коллапса один раз.
      for (const id of prev) {
        if (nextIdSet.has(id) || timersRef.current.has(id)) continue;
        const t = window.setTimeout(() => {
          timersRef.current.delete(id);
          setOrderedIds((cur) => cur.filter((c) => c !== id));
          setItemById((cur) => {
            if (!cur.has(id)) return cur;
            const next = new Map(cur);
            next.delete(id);
            return next;
          });
        }, ms);
        timersRef.current.set(id, t);
      }
      return mergeOrderedIds(prev, nextIds);
    });
    // getId/ms намеренно вне deps — эффект должен перезапускаться ТОЛЬКО когда меняются
    // сами данные (items), а не когда родитель на каждом рендере передаёт новую inline-ссылку
    // на getId (частый случай — `(t) => t.id`) или ms пересчитывается по неизменному значению
    // (EXIT_MS-константа/animations-флаг). Это верно, ПОКА оба стабильны по значению между
    // рендерами (даже если ссылка на getId меняется, сама функция ведёт себя одинаково) и
    // НЕ читаются больше нигде в этом эффекте, кроме как для одного и того же `items`. Если
    // когда-нибудь появится вызывающий, который меняет `ms` ДИНАМИЧЕСКИ (не при монтировании,
    // а посреди уже тикающих таймеров) и ожидает, что уже запущенные коллапсы подхватят новую
    // длительность — это перестанет быть безопасным, и `ms` придётся вернуть в deps (ценой
    // перезапуска эффекта на каждое изменение ms).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, []);

  const liveIds = new Set(items.map(getId));
  const result: ExitingListEntry<T>[] = [];
  for (const id of orderedIds) {
    const item = itemById.get(id);
    if (!item) continue;
    result.push({ item, exiting: !liveIds.has(id) });
  }
  return result;
}
