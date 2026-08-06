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

// Чистое решение «какие таймеры коллапса завести/снять на этот проход» — вынесено из
// эффекта, чтобы протестировать без React/DOM/поддельных таймеров. Проходит по ТЕМ ЖЕ
// id, что и prevOrder (ровно то, что уже отрисовано), и делит их на три исхода:
//  - toSchedule — id только что пропал из nextIds и ещё не таймерится — завести таймер;
//  - toClear    — id уже таймерится, НО вернулся живым в nextIds — снять таймер, иначе он
//                 всё равно сработает через `ms` и вычистит уже живой элемент (баг
//                 «возврат элемента внутри окна анимации», см. тест ниже);
//  - (без действия) — id пропал и уже таймерится, либо id живой и не таймерился.
export function reconcileExitTimers(
  prevOrder: readonly string[],
  nextIds: readonly string[],
  pendingTimerIds: ReadonlySet<string>,
): { toSchedule: string[]; toClear: string[] } {
  const nextIdSet = new Set(nextIds);
  const toSchedule: string[] = [];
  const toClear: string[] = [];
  for (const id of prevOrder) {
    const hasPendingTimer = pendingTimerIds.has(id);
    if (nextIdSet.has(id)) {
      if (hasPendingTimer) toClear.push(id);
      continue;
    }
    if (!hasPendingTimer) toSchedule.push(id);
  }
  return { toSchedule, toClear };
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

    // Свежее содержимое живых id (призраков не трогаем — их последний вид уже сохранён).
    setItemById((prev) => {
      const next = new Map(prev);
      for (const it of items) next.set(getId(it), it);
      return next;
    });

    setOrderedIds((prev) => {
      // orderedIds ДО merge — ровно то, что уже отрисовано; именно среди него решаем,
      // какие таймеры коллапса завести/снять (см. reconcileExitTimers).
      const { toSchedule, toClear } = reconcileExitTimers(prev, nextIds, new Set(timersRef.current.keys()));
      for (const id of toClear) {
        // Элемент вернулся живым ДО того, как отыграл собственный таймер коллапса
        // (оптимистичный move откатился, быстрый двойной тоггл «Скрыть выполненные»,
        // и т.п. — см. InboxCheckbox.rollback.test.ts). Не снять таймер здесь значило
        // бы, что он всё равно сработает через `ms` и вычистит уже живой элемент из
        // orderedIds/itemById — карточка пропала бы и вернулась только со следующей
        // сменой ссылки `items`, в хвост порядка.
        const pending = timersRef.current.get(id);
        if (pending !== undefined) window.clearTimeout(pending);
        timersRef.current.delete(id);
      }
      for (const id of toSchedule) {
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
