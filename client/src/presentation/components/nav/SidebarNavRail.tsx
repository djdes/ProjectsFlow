import { cloneElement, isValidElement, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

// Тип кнопки рейла:
// - 'tab' — вкладка-переключатель (Главная / Чат): активная остаётся «нажатой» и ОДНА
//   показывает подпись. Клик выбирает вкладку.
// - 'action' — кнопка действия (Задача / Входящие / Поиск): без persistent-active,
//   клик выполняет onAction, подписи нет никогда.
export type RailItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly badge?: number;
  readonly variant?: 'tab' | 'action';
  // Только для variant: 'action' — обработчик клика-действия.
  readonly onAction?: () => void;
};

// Навигационный рейл 1:1 с Notion (замер через CDP, см. reference/notion-project-page/
// MEASURED.md §5): слева вкладки-переключатели, справа кнопки-действия. Подпись есть
// ТОЛЬКО у активной вкладки — она раскрывается в пилюлю (h=32, radius 9999px, фон --active),
// остальные остаются кругами 32×32. Иконки (AnimatedXxx) оживают на hover/active.
export function SidebarNavRail({
  items,
  activeIndex,
  onSelect,
  compact = false,
}: {
  readonly items: readonly RailItem[];
  readonly activeIndex: number;
  // Вызывается при клике по вкладке (variant: 'tab'); index — позиция в исходном массиве.
  readonly onSelect: (index: number) => void;
  // Узкая панель: подписи не показываем даже активной вкладке — только круглые иконки.
  readonly compact?: boolean;
}): React.ReactElement {
  const { animations } = useMotion();
  const [hovered, setHovered] = useState<number | null>(null);

  const renderIcon = (item: RailItem, idx: number, forceActive: boolean): React.ReactNode => {
    const live = forceActive || idx === hovered;
    return isValidElement(item.icon)
      ? cloneElement(item.icon as React.ReactElement<{ active?: boolean }>, { active: live })
      : item.icon;
  };

  const badge = (item: RailItem): React.ReactNode =>
    item.badge !== undefined && item.badge > 0 ? (
      <span className="absolute -right-1.5 -top-1 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] text-primary-foreground">
        {item.badge > 99 ? '99+' : item.badge}
      </span>
    ) : null;

  // Кнопки разведены по двум группам, но индекс остаётся ИСХОДНЫМ: вызывающий мапит
  // onSelect(index) на свой RAIL_ORDER, поэтому позиция в массиве — часть контракта.
  const entries = items.map((item, index) => ({ item, index }));

  const renderButton = ({ item, index }: { item: RailItem; index: number }): React.ReactElement => {
    const isTab = item.variant !== 'action';
    const active = isTab && index === activeIndex;
    const showLabel = active && !compact;
    const hasBadge = item.badge !== undefined && item.badge > 0;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => (isTab ? onSelect(index) : item.onAction?.())}
        onMouseEnter={() => setHovered(index)}
        onMouseLeave={() => setHovered((h) => (h === index ? null : h))}
        onFocus={() => setHovered(index)}
        onBlur={() => setHovered((h) => (h === index ? null : h))}
        aria-label={item.label}
        // Подписи на кнопке может не быть вовсе — нативная подсказка оставляет её мыши.
        title={showLabel ? undefined : item.label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group/nav relative flex items-center rounded-full text-sm font-medium',
          // Ширина кнопки без подписи = иконка 20 + паддинги: px-1.5 → 32px, как в Notion
          // (MEASURED.md §5). На узкой панели — 28px: при SIDEBAR_MIN_WIDTH=176 внутри
          // px-2.5 у aside остаётся 156px, а пять 32-пиксельных кнопок с зазорами требуют
          // 176. Раньше дефицит целиком забирала левая группа (правая — shrink-0): кнопки
          // «Главная»/«Чат» ужимались до 22px, а бокс иконки size-5 shrink-0 не сжимался —
          // иконка вылезала за пилюлю. Компакт даёт 28+4+28 | 28+2+28+2+28 = 152 ≤ 156.
          compact ? 'h-7 px-1' : 'h-8 px-1.5',
          // В мобильном drawer (<768px) рендерится этот же рейл, и там кнопки — тач-цели.
          // 40×44: globals.css держит min-height 44 только до 640px, h-11 закрывает и полосу
          // 640…767. Шире 40 не делаем — иначе ряд не влезает в 88vw узких телефонов и
          // подпись активной вкладки начинает срезаться.
          'max-md:h-11 max-md:px-2.5',
          // Сжиматься может ТОЛЬКО кнопка с подписью — подпись отдаёт ширину первой
          // (у неё overflow-hidden). Пол сжатия = ширина пилюли без подписи (32px, на
          // мобиле 40px): ниже него ужалась бы сама иконка (size-5 shrink-0) и вылезла
          // за фон. Иконочные кнопки — shrink-0 по той же причине.
          showLabel ? 'min-w-8 max-md:min-w-10' : 'shrink-0',
          animations && 'transition-colors duration-200 ease-out',
          active
            ? 'bg-active text-foreground'
            : 'text-muted-foreground hover:bg-hover hover:text-foreground',
        )}
      >
        <span className="relative grid size-5 shrink-0 place-items-center">
          {renderIcon(item, index, active)}
          {badge(item)}
        </span>
        {/* Подпись выезжает шириной, а не появляется рывком. width:'auto' — motion измеряет
            реальную ширину текста (тот же приём, что в Collapse по высоте); overflow-hidden
            обнуляет автоминимум флекс-айтема, иначе width:0 не схлопнул бы подпись.
            Многоточия намеренно нет: во время раскрытия оно висело бы на каждом кадре. */}
        <motion.span
          className="overflow-hidden whitespace-nowrap"
          initial={false}
          animate={{
            width: showLabel ? 'auto' : 0,
            opacity: showLabel ? 1 : 0,
            // Бейдж непрочитанного висит на 6px правее иконки (-right-1.5) и заходит на
            // высоту строки, поэтому при marginLeft:6 подпись начиналась ровно на его
            // кромке — у активного «Чат» цифра касалась первой буквы. С бейджем даём 10.
            marginLeft: showLabel ? (hasBadge ? 10 : 6) : 0,
          }}
          transition={animations ? { duration: 0.22, ease: 'easeOut' } : { duration: 0 }}
        >
          {item.label}
        </motion.span>
      </button>
    );
  };

  return (
    <div className="flex items-center justify-between gap-1">
      {/* Слева — вкладки (Главная/Чат), справа — действия (Задача/Входящие/Поиск).
          Зазоры по замеру Notion (MEASURED.md §5: Chat 99…131, Meetings 133…165,
          Inbox 167…199): между иконками 2px, после активной пилюли — 4px. Разрыв между
          группами держит justify-between. */}
      <div className="flex min-w-0 items-center gap-1">
        {entries.filter((e) => e.item.variant !== 'action').map(renderButton)}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {entries.filter((e) => e.item.variant === 'action').map(renderButton)}
      </div>
    </div>
  );
}
