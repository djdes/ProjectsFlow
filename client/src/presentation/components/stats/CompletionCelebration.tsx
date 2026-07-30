import { useEffect, useState } from 'react';
import { ConfettiBurst } from '@/presentation/components/tasks/ConfettiBurst';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';

// Один праздник на всё приложение: слушает celebrationKey и роняет конфетти, из какой бы
// точки задачу ни закрыли. Раньше конфетти жило локально в KanbanBoard и срабатывало только
// на drag в «Готово» — клик по чекбоксу (список, инбокс, карточка, окно задачи) проходил молча.
export function CompletionCelebration(): React.ReactElement | null {
  const { celebrationKey } = useCompletedToday();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (celebrationKey > 0) setShown(celebrationKey);
  }, [celebrationKey]);

  if (shown === 0) return null;
  return <ConfettiBurst key={shown} onDone={() => setShown(0)} />;
}
