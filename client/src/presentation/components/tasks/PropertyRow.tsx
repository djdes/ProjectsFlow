import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
// (handle поддержан ниже — task 11 reorder)

// Notion-style строка свойства под заголовком задачи: слева приглушённая иконка +
// label в фиксированной колонке, справа — значение/контрол. Вся строка подсвечивается
// мягким hover:bg-hover (как в Notion). Колонка label сжимается на узких экранах,
// label может переноситься (работает вплоть до 320px).

interface PropertyRowProps {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  // Ручка перетаскивания (task 11): на hover строки показывается ВМЕСТО иконки.
  // Не задана — обычная иконка.
  handle?: React.ReactNode;
}

export function PropertyRow({ icon: Icon, label, children, handle }: PropertyRowProps): React.ReactElement {
  return (
    <div className="group/prop flex min-h-8 items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover">
      <span className="flex w-[130px] shrink-0 items-center gap-1.5 text-sm text-muted-foreground sm:w-[150px]">
        {handle ? (
          <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <Icon className="size-4 transition-opacity group-hover/prop:opacity-0" aria-hidden />
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/prop:opacity-100">
              {handle}
            </span>
          </span>
        ) : (
          <Icon className="size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 break-words">{label}</span>
      </span>
      {/* Значение — flex-контейнер: одинаковая вертикаль у всех контролов (chip/inline-flex
          типа Режима больше не «съезжает» по baseline). Перенос на 2-ю строку (напр.
          Ответственный + «Перенести в проект») разрешён. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

// Класс для inline-значений Notion-style: ghost-триггер, ink-текст когда значение
// задано (пикеры сами навешивают text-foreground поверх), muted-плейсхолдер когда
// пусто. -ml-1.5 выравнивает левый край значения с краем строки (компенсирует px у
// триггера-кнопки). Пикеры (DeadlinePicker/PrioritySelect/RalphModeSelect) принимают
// className на триггер и докидывают свой value-based цвет ПОСЛЕ — поэтому он выигрывает.
// ВАЖНО: size-варианты shadcn-кнопки задают РЕСПОНСИВНЫЕ h/px/text (`sm:px-3`,
// `sm:px-4`, `sm:text-xs`). twMerge не считает `px-1.5` и `sm:px-3` конфликтом
// (разные брейкпоинты), поэтому на десктопе побеждал бы sm:-паддинг кнопки — и
// у каждого пикера левый край значения «уезжал» по-своему. Дублируем sm:-оверрайды,
// чтобы все значения начинались строго на одной вертикали, единым шрифтом.
export const PROPERTY_VALUE_CLASS =
  '-ml-1.5 h-7 max-w-full justify-start gap-1.5 rounded-md border-0 bg-transparent px-1.5 ' +
  'text-sm font-normal shadow-none hover:bg-hover sm:h-7 sm:px-1.5 sm:text-sm';

// Тихий muted-плейсхолдер «Пусто» / «Никто» для свойств без редактирования.
export function EmptyValue({ children = 'Пусто' }: { children?: React.ReactNode }): React.ReactElement {
  return <span className="text-sm text-muted-foreground/70">{children}</span>;
}
