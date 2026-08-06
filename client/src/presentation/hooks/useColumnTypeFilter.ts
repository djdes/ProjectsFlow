import { useCallback, useEffect, useState } from 'react';
import type { ColumnTypeFilter } from '@/domain/task/taskTypeMeta';

// Личный фильтр колонок по типу задачи. Хранится локально в браузере, как порядок
// сортировки «Готово» (useDoneSortOrder) — настройки доски в projects.kanban_settings
// общие на проект, и фильтр там скрыл бы карточки всей команде.
//
// Одна запись на проект (карта «статус колонки → режим»), а не ключ на колонку: карта
// читается и пишется целиком, и от удалённой кастомной колонки остаётся мусор максимум
// внутри одного значения.
const STORAGE_PREFIX = 'pf-column-type-filter:';

type FilterMap = Record<string, ColumnTypeFilter>;

function isMode(v: unknown): v is ColumnTypeFilter {
  return v === 'all' || v === 'bug' || v === 'feature';
}

function readInitial(projectId: string): FilterMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + projectId);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: FilterMap = {};
    for (const [status, mode] of Object.entries(parsed as Record<string, unknown>)) {
      if (isMode(mode) && mode !== 'all') out[status] = mode;
    }
    return out;
  } catch {
    // Испорченное значение (ручная правка, старый формат) не должно ронять доску.
    return {};
  }
}

export function useColumnTypeFilter(projectId: string): {
  filterFor: (status: string) => ColumnTypeFilter;
  setFilter: (status: string, mode: ColumnTypeFilter) => void;
} {
  const [filters, setFilters] = useState<FilterMap>(() => readInitial(projectId));

  // Переключение проекта: доска переиспользует компонент, поэтому карту перечитываем.
  useEffect(() => {
    setFilters(readInitial(projectId));
  }, [projectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // Пустая карта не пишется в хранилище — иначе на каждый посещённый проект
      // остаётся ключ со значением '{}', даже если фильтр никогда не включали.
      // Заодно это самоочистка: сняли последний фильтр — ключ убран.
      if (Object.keys(filters).length === 0) {
        window.localStorage.removeItem(STORAGE_PREFIX + projectId);
      } else {
        window.localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(filters));
      }
    } catch {
      // Переполненное/заблокированное хранилище не должно ломать работу с доской.
    }
  }, [filters, projectId]);

  const filterFor = useCallback(
    (status: string): ColumnTypeFilter => filters[status] ?? 'all',
    [filters],
  );

  const setFilter = useCallback((status: string, mode: ColumnTypeFilter): void => {
    setFilters((prev) => {
      // 'all' — состояние по умолчанию, в хранилище его не держим.
      if (mode === 'all') {
        if (!(status in prev)) return prev;
        const next = { ...prev };
        delete next[status];
        return next;
      }
      if (prev[status] === mode) return prev;
      return { ...prev, [status]: mode };
    });
  }, []);

  return { filterFor, setFilter };
}
