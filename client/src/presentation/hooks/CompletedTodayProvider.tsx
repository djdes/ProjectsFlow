import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { LIVE_CHANGED_EVENT, REALTIME_CONNECTED_EVENT, TASK_CHANGED_EVENT } from './useNotificationStream';

type CompletedToday = {
  // Сколько задач я закрыл сегодня. null — ещё не загрузили (пилюлю не рисуем).
  readonly count: number | null;
  // Растёт на каждое ЗАСЧИТАННОЕ закрытие: пилюля и конфетти перезапускают анимацию.
  readonly celebrationKey: number;
  // Праздник запускается один раз на задачу за сессию. Цифру всегда сверяем с сервером:
  // realtime мог уже учесть это закрытие, поэтому локальный +1 дал бы двойной зачёт.
  // Можно вызвать до ответа сервера ради анимации (ApprovalItemCard.startAccept).
  // При ошибке forget() снимает локальную отметку и перечитывает действительную цифру.
  readonly celebrate: (taskId: string) => void;
  // Задача вернулась в работу (возврат руководителем или отзыв исполнителем) — она больше
  // не выполнена. Забываем её и пересчитываем цифру с сервера: он считает по текущему
  // состоянию задач, и локальная арифметика тут только разошлась бы с ним.
  readonly forget: (taskId: string) => void;
};

const CompletedTodayContext = createContext<CompletedToday | null>(null);

// Локальная полночь: «сегодня» — календарное понятие, и границу суток задаёт клиент
// (сервер в UTC). Пересчитываем при каждом запросе — сессия живёт дольше суток.
function localMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Счётчик «выполнено сегодня» для мотивационной пилюли. Живёт над роутером, чтобы цифра не
// сбрасывалась при переходах между страницами, и чтобы любая точка закрытия задачи
// (чекбокс в списке, ховер-кнопка на карточке, drag в «Готово») запускала один и тот же
// праздник — раньше конфетти было только у drag'а на доске.
export function CompletedTodayProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { statsRepository } = useContainer();
  const [count, setCount] = useState<number | null>(null);
  const [celebrationKey, setCelebrationKey] = useState(0);
  // Дата суток, для которых загружен счётчик: сессию оставляют открытой на ночь, и утром
  // цифра должна начаться с нуля, а не продолжить вчерашнюю.
  const dayRef = useRef<string>('');
  const requestRef = useRef({ generation: 0 });

  const refresh = useCallback((): void => {
    const requestId = ++requestRef.current.generation;
    const midnight = localMidnight();
    // Сутки сменились — набор засчитанных задач больше не про сегодня.
    if (dayRef.current && dayRef.current !== midnight.toDateString()) countedRef.current.clear();
    dayRef.current = midnight.toDateString();
    statsRepository
      .completedToday(midnight)
      .then(next => { if (requestId === requestRef.current.generation) setCount(next); })
      .catch(() => {
        // Тихо: мотивационный счётчик не повод показывать ошибку поверх работы.
      });
  }, [statsRepository]);

  useEffect(() => {
    const requests = requestRef.current;
    refresh();
    const onChanged = (): void => refresh();
    window.addEventListener(TASK_CHANGED_EVENT, onChanged);
    window.addEventListener(LIVE_CHANGED_EVENT, onChanged);
    window.addEventListener(REALTIME_CONNECTED_EVENT, onChanged);
    window.addEventListener('focus', onChanged);
    // Recover a missed event and a date change even while the tab stays open.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 60_000);
    return () => {
      ++requests.generation;
      window.clearInterval(timer);
      window.removeEventListener(TASK_CHANGED_EVENT, onChanged);
      window.removeEventListener(LIVE_CHANGED_EVENT, onChanged);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, onChanged);
      window.removeEventListener('focus', onChanged);
    };
  }, [refresh]);

  // Вернулись во вкладку — сверяем цифру: задачи закрываются и с телефона тоже, а за время
  // отсутствия могли наступить новые сутки.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (dayRef.current !== localMidnight().toDateString()) setCount(null);
      refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  // Задачи, для которых в этой сессии уже показан праздник.
  const countedRef = useRef<Set<string>>(new Set());

  const celebrate = useCallback(
    (taskId: string): void => {
      if (countedRef.current.has(taskId)) return;
      countedRef.current.add(taskId);
      setCelebrationKey((k) => k + 1);
      refresh();
    },
    [refresh],
  );

  const forget = useCallback(
    (taskId: string): void => {
      countedRef.current.delete(taskId);
      refresh();
    },
    [refresh],
  );

  const value = useMemo(
    () => ({ count, celebrationKey, celebrate, forget }),
    [count, celebrationKey, celebrate, forget],
  );

  return (
    <CompletedTodayContext.Provider value={value}>{children}</CompletedTodayContext.Provider>
  );
}

// Вне провайдера — no-op вместо исключения: закрыть задачу можно и из окна, отрисованного
// в изоляции (сторибук-подобные экраны, публичная доска), а праздник там не обязателен.
const NOOP: CompletedToday = {
  count: null,
  celebrationKey: 0,
  celebrate: () => {},
  forget: () => {},
};

export function useCompletedToday(): CompletedToday {
  return useContext(CompletedTodayContext) ?? NOOP;
}
