import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';

type CompletedToday = {
  // Сколько задач я закрыл сегодня. null — ещё не загрузили (пилюлю не рисуем).
  readonly count: number | null;
  // Растёт на каждое ЗАСЧИТАННОЕ закрытие: пилюля и конфетти перезапускают анимацию.
  readonly celebrationKey: number;
  // Вызывать ПОСЛЕ успешного ответа сервера. Задача, уже закрытая сегодня, не считается
  // повторно и праздника не запускает — иначе цикл «выполнил → забрал с утверждения →
  // выполнил снова» накручивал бы ранг одной задачей.
  readonly celebrate: (taskId: string) => void;
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

  const refresh = useCallback((): void => {
    const midnight = localMidnight();
    // Сутки сменились — набор засчитанных задач больше не про сегодня.
    if (dayRef.current && dayRef.current !== midnight.toDateString()) countedRef.current.clear();
    dayRef.current = midnight.toDateString();
    statsRepository
      .completedToday(midnight)
      .then(setCount)
      .catch(() => {
        // Тихо: мотивационный счётчик не повод показывать ошибку поверх работы.
      });
  }, [statsRepository]);

  useEffect(() => {
    refresh();
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

  // Задачи, уже засчитанные в этой сессии. Сервер считает РАЗНЫЕ задачи, и клиент обязан
  // считать так же — иначе локальная цифра разъезжается с реальной до ближайшего refresh.
  const countedRef = useRef<Set<string>>(new Set());

  const celebrate = useCallback(
    (taskId: string): void => {
      if (countedRef.current.has(taskId)) return;
      countedRef.current.add(taskId);
      setCount((c) => (c ?? 0) + 1);
      setCelebrationKey((k) => k + 1);
    },
    [],
  );

  const value = useMemo(
    () => ({ count, celebrationKey, celebrate }),
    [count, celebrationKey, celebrate],
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
};

export function useCompletedToday(): CompletedToday {
  return useContext(CompletedTodayContext) ?? NOOP;
}
