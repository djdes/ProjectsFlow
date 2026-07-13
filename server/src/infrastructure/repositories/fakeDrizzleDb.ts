// Минимальный fake Drizzle-подобного `db` для юнит-тестов репозиториев без реальной БД
// (интеграционных тестов на реальной MariaDB в этом кодбейзе нет ни для одного Drizzle-репо —
// локальная тестовая БД недоступна, см. CLAUDE.md / memory «Local DB migrate broken at 054»).
// Каждый метод select-чейна возвращает себя; результат резолвится либо терминальным `limit()`,
// либо прямым `await` самого чейна (чейн — thenable): методы вроде
// DrizzleTaskDelegationRepository.listAssignedTo/listDelegatedToOthers завершаются на `.where()`
// БЕЗ `.limit()`, поэтому чейн должен резолвиться при await-е напрямую. chain-форма
// (from/innerJoin/leftJoin/where/orderBy/limit) НЕ проверяется — только факт «что вернул select».
// Достаточно для регресс-тестов блокеров #3/#4/#5 (полагаемость на порт для гейтинга) и
// wiring-тестов блокеров #1/#2 (роль/членство берётся ИЗ ПОРТА, а не из project_members-select).
//
// selectRowsSeq — очередь наборов строк на последовательные вызовы `select()` (для методов с
// несколькими выборками, напр. listDelegatedToOthers: named-ветка + inbox-ветка); при
// исчерпании очереди/если она не задана используется selectRows (общий набор на все select).
export function fakeDb(opts: {
  readonly selectRows?: readonly unknown[];
  readonly selectRowsSeq?: readonly (readonly unknown[])[];
  readonly onSelect?: () => void;
  readonly onInsertValues?: (values: unknown) => void;
}) {
  const queue = opts.selectRowsSeq ? opts.selectRowsSeq.map((r) => [...r]) : null;
  const defaultRows = opts.selectRows ?? [];

  function makeSelectChain(rows: readonly unknown[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const self = (): Record<string, unknown> => chain;
    const resolve = (): Promise<unknown[]> => Promise.resolve([...rows]);
    Object.assign(chain, {
      from: self,
      innerJoin: self,
      leftJoin: self,
      where: self,
      orderBy: self,
      limit: resolve,
      // thenable: чейны, завершающиеся на .where()/.orderBy() без .limit(), резолвятся
      // прямым await (см. listAssignedTo/listDelegatedToOthers). Плоский массив строк —
      // не thenable, поэтому рекурсивного разворачивания await не будет.
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => resolve().then(onF, onR),
    });
    return chain;
  }

  const insertChain: Record<string, unknown> = {};
  Object.assign(insertChain, {
    values: (v: unknown) => {
      opts.onInsertValues?.(v);
      return insertChain;
    },
    onDuplicateKeyUpdate: () => Promise.resolve(),
  });

  return {
    select: () => {
      opts.onSelect?.();
      const rows = queue && queue.length > 0 ? (queue.shift() as readonly unknown[]) : defaultRows;
      return makeSelectChain(rows);
    },
    insert: () => insertChain,
  };
}
