import { useEffect, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import type { Task } from '@/domain/task/Task';
import { ManualIcon } from './inbox/InboxChrome';
import { Check } from 'lucide-react';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { useCardSwipe } from '@/presentation/hooks/useCardSwipe';

type Props = {
  tasks: readonly Task[];
  // Карточку рисует доска: у неё уже собраны все обработчики колонок, и дублировать
  // полтора десятка пропов сюда незачем.
  renderCard: (task: Task) => React.ReactNode;
  // Растёт на каждое попадание задачи в полку — полка вспыхивает.
  flashKey: number;
  // Какую карточку подсветить вместе с полкой.
  flashTaskId: string | null;
  // Подпись полки. Полка ЗАМЕНЯЕТ собой колонку 'manual', поэтому и называться должна
  // так же, как эта колонка названа в настройках доски (дефолт — «Вручную»). Раньше здесь
  // был хардкод «В работе», и одно и то же слово означало разное на доске (колонка manual)
  // и в дайджестах/TG/EOD (статус in_progress).
  label: string;
  // Свайп карточки вправо = «сделано». undefined — жест выключен (нет прав на правку).
  onComplete?: (task: Task) => void;
  className?: string;
};

// Полка «Вручную» на доске проекта — та же зона, что в колонке «Сейчас» «Входящих», и тот же
// статус 'manual': нейтральная серая панель с янтарной меткой (дизайн C4 — цвет в метке, а
// не в заливке). На доске она ЗАМЕНЯЕТ колонку «Вручную»: одно место для «делаю руками»,
// без дублирования карточек в двух местах сразу.
//
// Дроп обрабатывает общий handleDragEnd доски: id и data совпадают с колонкой
// (`column-manual`, type: 'column'), поэтому никакой отдельной ветки в drag-логике не нужно.
export function BoardWorkShelf({
  tasks,
  renderCard,
  flashKey,
  flashTaskId,
  label,
  onComplete,
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
        data-pf-work-shelf
        className={cn(
          'relative min-w-0 rounded-xl bg-panel p-[7px] transition-[background-color,outline-color] duration-150',
          isOver && 'bg-manual-zone outline outline-2 -outline-offset-2 outline-primary',
          flash && 'pf-shelf-flash',
        )}
      >
        <div className="mbe-[5px] flex h-7 min-w-0 items-center gap-1.5 px-[3px] text-ui">
          <span className="pf-tag pf-tag-lg pf-tag-plain pf-tone-manual min-w-0">
            <ManualIcon className="text-manual" />
            <span className="truncate">{label}</span>
          </span>
          {tasks.length > 0 && <span className="tabular-nums text-muted-foreground">{tasks.length}</span>}
        </div>
        {tasks.length === 0 ? (
          <div className="grid h-8 place-items-center rounded-[7px] border border-dashed border-drop-line px-2 text-center text-xs text-muted-foreground">
            Перетащите сюда задачу, которой заняты
          </div>
        ) : (
          <SortableContext items={tasks.map((t) => t.id)}>
            <div className="flex flex-wrap gap-[5px]">
              {tasks.map((t) => (
                <ShelfCard
                  key={t.id}
                  flashing={flash && t.id === flashTaskId}
                  {...(onComplete ? { onComplete: () => onComplete(t) } : {})}
                >
                  {renderCard(t)}
                </ShelfCard>
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    </div>
  );
}

/**
 * Карточка внутри полки: та же обёртка, что была раньше, плюс свайп «вправо = готово»
 * на тач-устройствах.
 *
 * Почему свайп только здесь, а не на всех карточках доски: полка — единственное место,
 * где следующий шаг однозначен («делаю руками» → «готово»). В колонках следующий статус
 * зависит от колонки, и один и тот же жест означал бы разное.
 *
 * Кнопочный путь никуда не делся: в мобильном ряду действий карточки есть стрелка
 * «передать дальше» — свайп её дублирует, а не заменяет.
 */
function ShelfCard({
  children,
  flashing,
  onComplete,
}: {
  children: React.ReactNode;
  flashing: boolean;
  onComplete?: () => void;
}): React.ReactElement {
  const { animations } = useMotion();
  const { ref, offset, armed } = useCardSwipe({
    disabled: !onComplete,
    onCommit: () => onComplete?.(),
  });

  return (
    <div
      // rounded-xl — чтобы вспышка (::after с border-radius: inherit) повторяла
      // скругление карточки. Фона и рамки у обёртки нет.
      className={cn(
        // Mobile cards fit the bounded shelf; desktop keeps the compact card width.
        'relative w-full min-w-0 max-w-full shrink-0 grow-0 rounded-lg sm:w-[17rem]',
        flashing && 'pf-card-flash',
      )}
      // Document-level жест сайдбара не должен перехватывать свайп карточки.
      data-pf-no-edge-swipe
      ref={ref}
    >
      {/* Подложка: видна ровно настолько, насколько утащили карточку. */}
      {offset > 0 && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center rounded-lg ps-3 text-sm font-medium text-done-ink transition-colors',
            armed ? 'bg-done-soft-hover' : 'bg-done-soft',
          )}
        >
          <Check className="me-1.5 size-4" />
          Готово
        </div>
      )}
      <div
        className="relative"
        style={{
          transform: offset > 0 ? `translateX(${offset}px)` : undefined,
          // Возврат на место — только когда палец отпущен (offset обнулён) и анимации
          // не выключены настройкой/pointer:coarse-правилами проекта.
          transition: offset === 0 && animations ? 'transform 180ms ease-out' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
