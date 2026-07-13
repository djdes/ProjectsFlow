// Минимальный fake Drizzle-подобного `db` для юнит-тестов репозиториев без реальной БД
// (интеграционных тестов на реальной MariaDB в этом кодбейзе нет ни для одного Drizzle-репо —
// локальная тестовая БД недоступна, см. CLAUDE.md / memory «Local DB migrate broken at 054»).
// Каждый метод select-чейна просто возвращает себя; терминальный `limit()` резолвит заранее
// заданные canned-строки — chain-форма (from/innerJoin/leftJoin/where/orderBy/limit)
// НЕ проверяется, только факт «что вернул select». Этого достаточно для регресс-тестов
// блокеров #3/#4/#5 (fix-blockers-report.md): они проверяют, что репозиторий ПОЛНОСТЬЮ
// полагается на внедрённый ProjectMemberRepository для гейтинга (пуст список → 0 запросов
// к db.select, короткое замыкание до похода в БД), а не на project_members.
export function fakeDb(opts: {
  readonly selectRows?: readonly unknown[];
  readonly onSelect?: () => void;
  readonly onInsertValues?: (values: unknown) => void;
}) {
  const selectChain: Record<string, unknown> = {};
  const self = (): Record<string, unknown> => selectChain;
  Object.assign(selectChain, {
    from: self,
    innerJoin: self,
    leftJoin: self,
    where: self,
    orderBy: self,
    limit: () => Promise.resolve([...(opts.selectRows ?? [])]),
  });

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
      return selectChain;
    },
    insert: () => insertChain,
  };
}
