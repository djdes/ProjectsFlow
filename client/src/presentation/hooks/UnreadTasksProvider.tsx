import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import {
  REALTIME_CONNECTED_EVENT,
  TASK_CHANGED_EVENT,
} from '@/presentation/hooks/useNotificationStream';

type UnreadTasks = {
  // Непрочитана ли задача для текущего пользователя.
  readonly isUnread: (taskId: string) => boolean;
  // Сколько всего непрочитанных — счётчик на иконке «Входящие».
  readonly count: number;
  // Пометить прочитанной локально — вызывать при открытии задачи, вместе с записью
  // просмотра на сервере. Ждать ответа сервера незачем: подсветка должна гаснуть сразу.
  readonly markRead: (taskId: string) => void;
  // Перечитать список с сервера (новая задача могла приехать по realtime).
  readonly refresh: () => void;
};

const UnreadTasksContext = createContext<UnreadTasks | null>(null);

// Непрочитанные задачи: назначены на меня и ни разу мной не открыты. Нужны, чтобы занятый
// человек не пропустил появившуюся задачу — поэтому подсветка живёт на карточке, а не в
// уведомлениях, которые легко смахнуть не глядя.
//
// Провайдер держит только id: сами задачи приходят из обычных списков, и такой эндпоинт
// дёшево звать на каждой странице.
export function UnreadTasksProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { statsRepository } = useContainer();
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  const refresh = useCallback((): void => {
    statsRepository
      .unreadTaskIds()
      .then((list) => setIds(new Set(list)))
      .catch(() => {
        // Тихо: подсветка — подсказка, а не повод показывать ошибку поверх работы.
      });
  }, [statsRepository]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Вернулись во вкладку — перечитываем: пока человека не было, ему могли делегировать
  // задачу, и подсветка должна появиться без перезагрузки страницы.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  // Задачу назначили прямо сейчас — счётчик на «Входящих» должен подрасти без перезагрузки
  // и без перехода на другую вкладку. Дебаунс: серия правок (приоритет + дедлайн + перенос)
  // даёт пачку событий, а нам хватает одного перечитывания в конце пачки.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => refresh(), 250);
    };
    window.addEventListener(TASK_CHANGED_EVENT, schedule);
    // Реконнект SSE: события за время обрыва до нас не дошли — читаем снапшот.
    window.addEventListener(REALTIME_CONNECTED_EVENT, schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TASK_CHANGED_EVENT, schedule);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, schedule);
    };
  }, [refresh]);

  const markRead = useCallback((taskId: string): void => {
    setIds((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }, []);

  const isUnread = useCallback((taskId: string): boolean => ids.has(taskId), [ids]);

  const value = useMemo(
    () => ({ isUnread, count: ids.size, markRead, refresh }),
    [isUnread, ids, markRead, refresh],
  );

  return <UnreadTasksContext.Provider value={value}>{children}</UnreadTasksContext.Provider>;
}

// Вне провайдера — no-op: карточка может рендериться и в изоляции (публичная доска,
// предпросмотр), и там подсветка непрочитанного не нужна.
const NOOP: UnreadTasks = {
  isUnread: () => false,
  count: 0,
  markRead: () => {},
  refresh: () => {},
};

export function useUnreadTasks(): UnreadTasks {
  return useContext(UnreadTasksContext) ?? NOOP;
}
