import * as React from 'react';
import { type LucideIcon } from 'lucide-react';

// Notion-style строка свойства под заголовком задачи: слева приглушённая иконка +
// label в фиксированной колонке, справа — значение/контрол. Вся строка подсвечивается
// мягким hover:bg-hover (как в Notion). Колонка label сжимается на узких экранах,
// label может переноситься (работает вплоть до 320px).

interface PropertyRowProps {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}

export function PropertyRow({ icon: Icon, label, children }: PropertyRowProps): React.ReactElement {
  return (
    <div className="group/prop flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-hover">
      <span className="flex w-[130px] shrink-0 items-center gap-1.5 pt-1 text-sm text-muted-foreground sm:w-[150px]">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{label}</span>
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Класс для inline-значений Notion-style: ghost-триггер, ink-текст когда значение
// задано (пикеры сами навешивают text-foreground поверх), muted-плейсхолдер когда
// пусто. -ml-1.5 выравнивает левый край значения с краем строки (компенсирует px у
// триггера-кнопки). Пикеры (DeadlinePicker/PrioritySelect/RalphModeSelect) принимают
// className на триггер и докидывают свой value-based цвет ПОСЛЕ — поэтому он выигрывает.
export const PROPERTY_VALUE_CLASS =
  '-ml-1.5 h-7 max-w-full justify-start gap-1.5 rounded-md border-0 bg-transparent px-1.5 ' +
  'text-sm font-normal shadow-none hover:bg-hover';

// Тихий muted-плейсхолдер «Пусто» / «Никто» для свойств без редактирования.
export function EmptyValue({ children = 'Пусто' }: { children?: React.ReactNode }): React.ReactElement {
  return <span className="text-sm text-muted-foreground/70">{children}</span>;
}
