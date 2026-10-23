import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useContainer } from '@/infrastructure/di/container';
import type { AwaitingReplyTask } from '@/domain/task/AwaitingReplyTask';
import {
  NOTIFICATIONS_CHANGED_EVENT,
  REALTIME_CONNECTED_EVENT,
  TASK_CHANGED_EVENT,
} from '@/presentation/hooks/useNotificationStream';

type AwaitingReply = {
  // Задачи, где меня ждут с ответом: новые вопросы сверху.
  readonly tasks: readonly AwaitingReplyTask[];
  // Вопрос, который ждёт моего ответа в этой задаче (null — не ждёт).
  readonly questionFor: (taskId: string) => AwaitingReplyTask['question'] | null;
  // Я ответил в задаче — подсветка гаснет сразу, не дожидаясь перечитывания.
  readonly markAnswered: (taskId: string) => void;
  readonly refresh: () => void;
};

const AwaitingReplyContext = createContext<AwaitingReply | null>(null);

// Задачи, где мне адресовали комментарий («Кого уведомить» или @), а я ещё не ответил.
// Подсветка карточек на досках и фильтр «Ответить» во «Входящих» читают один список: так
// руководитель видит вопросы и в чужих задачах, которых нет в его собственных лентах.
// Обновление — как у UnreadTasksProvider: переход, возврат во вкладку, realtime-события.
export function AwaitingReplyProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { taskAssigneeRepository } = useContainer();
  const [tasks, setTasks] = useState<readonly AwaitingReplyTask[]>([]);
  const requestSequence = useRef(0);

  const refresh = useCallback((): void => {
    const request = ++requestSequence.current;
    taskAssigneeRepository
      .listAwaitingReply()
      .then(list => { if (request === requestSequence.current) setTasks(list); })
      .catch(() => {
        // Тихо: подсветка — подсказка, а не повод показывать ошибку поверх работы.
      });
  }, [taskAssigneeRepository]);

  const { pathname } = useLocation();
  useEffect(() => {
    refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  // Адресованный мне комментарий приходит уведомлением, чужой ответ или закрытие задачи —
  // событием изменения задачи; пачку событий схлопываем в одно чтение.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => refresh(), 250);
    };
    window.addEventListener(TASK_CHANGED_EVENT, schedule);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, schedule);
    window.addEventListener(REALTIME_CONNECTED_EVENT, schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TASK_CHANGED_EVENT, schedule);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, schedule);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, schedule);
    };
  }, [refresh]);

  const markAnswered = useCallback((taskId: string): void => {
    setTasks((prev) => (prev.some((t) => t.id === taskId) ? prev.filter((t) => t.id !== taskId) : prev));
  }, []);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t.question])), [tasks]);
  const questionFor = useCallback((taskId: string) => byId.get(taskId) ?? null, [byId]);

  const value = useMemo(
    () => ({ tasks, questionFor, markAnswered, refresh }),
    [tasks, questionFor, markAnswered, refresh],
  );

  return <AwaitingReplyContext.Provider value={value}>{children}</AwaitingReplyContext.Provider>;
}

// Вне провайдера — no-op: карточка рендерится и в изоляции (публичная доска, предпросмотр).
const NOOP: AwaitingReply = {
  tasks: [],
  questionFor: () => null,
  markAnswered: () => {},
  refresh: () => {},
};

export function useAwaitingReply(): AwaitingReply {
  return useContext(AwaitingReplyContext) ?? NOOP;
}
