import { useEffect, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import type { Task } from '@/domain/task/Task';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

type Props = {
  tasks: readonly Task[];
  // Карточку рисует доска: у неё уже собраны все обработчики колонок, и дублировать
  // полтора десятка пропов сюда незачем.
  renderCard: (task: Task) => React.ReactNode;
  // Растёт на каждое попадание задачи в полку — полка вспыхивает.
  flashKey: number;
  // Какую карточку подсветить вместе с полкой.
  flashTaskId: string | null;
  className?: string;
};

// Полка «В работе» на доске проекта — та же тёплая зона, что во «Входящих», и тот же
// статус 'manual'. На доске она ЗАМЕНЯЕТ колонку «Вручную»: одно место для «делаю руками»,
// без дублирования карточек в двух местах сразу.
//
// Дроп обрабатывает общий handleDragEnd доски: id и data совпадают с колонкой
// (`column-manual`, type: 'column'), поэтому никакой отдельной ветки в drag-логике не нужно.
export function BoardWorkShelf({
  tasks,
  renderCard,
  flashKey,
  flashTaskId,
  className,
}: Props): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: 'column-manual',
    data: { type: 'column', status: 'manual' },
  });
  const { animations } = useMotion();
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (flashKey === 0 || !animations) return;
    // Снимаем класс на кадр: без этого повторная вспышка не стартует — класс уже висит.
    setFlash(false);
    const raf = requestAnimationFrame(() => setFlash(true));
    const off = window.setTimeout(() => setFlash(false), 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(off);
    };
  }, [flashKey, animations]);

  return (
    <div className={className}>
      <div
        ref={setNodeRef}
        className={cn(
          'relative rounded-xl border border-amber-300/50 bg-amber-100/45 px-2.5 py-2 transition-colors duration-150',
          'dark:border-amber-400/20 dark:bg-amber-400/[0.07]',
          isOver && 'border-amber-400/80 bg-amber-200/60 dark:border-amber-300/50 dark:bg-amber-400/[0.16]',
          flash && 'pf-shelf-flash',
        )}
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300/90">
          <span>В работе</span>
          {tasks.length > 0 && <span className="tabular-nums opacity-70">{tasks.length}</span>}
        </div>
        {tasks.length === 0 ? (
          <p className="px-0.5 py-1 text-xs text-amber-800/60 dark:text-amber-200/45">
            Перетащите сюда задачу, которой занимаетесь сейчас.
          </p>
        ) : (
          <SortableContext items={tasks.map((t) => t.id)}>
            <div className="flex flex-wrap gap-2">
              {tasks.map((t) => (
                <div
                  key={t.id}
                  // rounded-xl — чтобы вспышка (::after с border-radius: inherit) повторяла
                  // скругление карточки. Фона и рамки у обёртки нет.
                  className={cn(
                    'relative w-full min-w-0 max-w-[17rem] rounded-xl',
                    flash && t.id === flashTaskId && 'pf-card-flash',
                  )}
                >
                  {renderCard(t)}
                </div>
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    </div>
  );
}
