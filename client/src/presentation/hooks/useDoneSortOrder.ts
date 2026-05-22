import { useCallback, useEffect, useState } from 'react';

// Порядок сортировки колонки «Готово». Хранится локально в браузере (как тема),
// без серверной синхронизации — см. ТЗ 2026-05-22, фича №3.
export type DoneSortOrder = 'newest' | 'oldest';

const STORAGE_KEY = 'pf-done-order';

function readInitial(): DoneSortOrder {
  if (typeof window === 'undefined') return 'newest';
  return window.localStorage.getItem(STORAGE_KEY) === 'oldest' ? 'oldest' : 'newest';
}

export function useDoneSortOrder(): { order: DoneSortOrder; toggle: () => void } {
  const [order, setOrder] = useState<DoneSortOrder>(readInitial);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, order);
  }, [order]);

  const toggle = useCallback(() => {
    setOrder((o) => (o === 'newest' ? 'oldest' : 'newest'));
  }, []);

  return { order, toggle };
}
