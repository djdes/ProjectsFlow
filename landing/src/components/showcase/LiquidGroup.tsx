import React, { useRef } from 'react';
import { LIQUID_ITEM_BG, useLiquidPill } from '../../lib/liquid';

// Группа пунктов с общей «жидкой» подложкой выбранного (lib/liquid.ts). Пункты помечаются
// data-liquid-item и data-liquid-active, стоят над индикатором (relative z-[1]) и берут
// подложку и цвета из liquidItem() — по доле себя под индикатором (--liquid-on).

type GroupProps = {
  activeKey: unknown;
  className?: string;
  indicatorClassName?: string;
  // Цвет подложки выбранного (CSS): им же закрашен выбранный пункт до запуска скрипта.
  pill?: string;
  style?: React.CSSProperties;
  as?: 'div' | 'nav';
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'style' | 'className' | 'children'>;

export function LiquidGroup({
  activeKey,
  className = '',
  indicatorClassName = '',
  pill,
  style,
  as = 'div',
  children,
  ...rest
}: GroupProps): React.ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  useLiquidPill({ containerRef: ref, indicatorRef, activeSelector: '[data-liquid-active="true"]', activeKey });
  const Tag = as;
  const groupStyle = { ...style, ...(pill ? { '--liquid-pill': pill } : {}) } as React.CSSProperties;
  return (
    <Tag
      ref={(el: HTMLElement | null) => {
        ref.current = el;
      }}
      className={`relative isolate ${className}`}
      style={groupStyle}
      {...rest}
    >
      <span ref={indicatorRef} aria-hidden="true" className={`liquid-indicator ${indicatorClassName}`} />
      {children}
    </Tag>
  );
}

/** Атрибуты и стиль пункта группы: подложка и --liquid-on (до запуска скрипта — 1 у выбранного). */
export function liquidItem(active: boolean, style: React.CSSProperties = {}): {
  'data-liquid-item': '';
  'data-liquid-active': boolean;
  style: React.CSSProperties;
} {
  return {
    'data-liquid-item': '',
    'data-liquid-active': active,
    style: { '--liquid-on': active ? 1 : 0, background: LIQUID_ITEM_BG, ...style } as React.CSSProperties,
  };
}
