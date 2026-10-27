import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

// Базовая ширина подложки активной вкладки: настоящую ширину даёт scaleX, чтобы переезд
// между вкладками шёл одним transform, без анимации left/width.
const TAB_INDICATOR_BASE = 100;

export function TabsList({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.List
>): React.ReactElement {
  const list = React.useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = React.useState<{
    left: number;
    width: number;
    top: number;
    height: number;
  } | null>(null);
  React.useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const update = (): void => {
      const active = element.querySelector<HTMLElement>(
        '[role="tab"][data-state="active"]',
      );
      if (!active) {
        setIndicator(null);
        return;
      }
      const rect = active.getBoundingClientRect(),
        parent = element.getBoundingClientRect();
      const next = {
        left: rect.left - parent.left + element.scrollLeft,
        width: rect.width,
        top: rect.top - parent.top + element.scrollTop,
        height: rect.height,
      };
      setIndicator((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            previous[key as keyof typeof next] ===
            next[key as keyof typeof next],
        )
          ? previous
          : next,
      );
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const mutation = new MutationObserver(update);
    mutation.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, []);
  return (
    <TabsPrimitive.List
      ref={list}
      className={cn(
        // max-sm:h-auto — на телефоне вкладки-кнопки получают тач-высоту 44px (globals.css),
        // и полоса растёт под них, а не обрезает.
        // Телефон: не шире экрана и листается вбок. Пять вкладок админки вылезали за правый
        // край, а <main> обрезает горизонталь — «Email» и «ИИ» было не достать. justify-start:
        // у центрированного переполненного ряда начало уходит за левый край без прокрутки.
        'pf-tabs relative isolate inline-flex h-8 items-center justify-center rounded-lg bg-foreground/[0.06] p-0.5 text-muted-foreground max-sm:h-auto max-sm:max-w-full max-sm:justify-start max-sm:overflow-x-auto pf-scrollbar-hide dark:border dark:border-border dark:bg-panel',
        className,
      )}
      {...props}
    >
      {indicator && (
        <span
          aria-hidden="true"
          className="pf-tab-indicator pointer-events-none absolute rounded-md bg-background shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] dark:bg-raised dark:shadow-none"
          style={{
            left: 0,
            top: 0,
            width: TAB_INDICATOR_BASE,
            height: indicator.height,
            transformOrigin: '0 0',
            transform: `translate(${indicator.left}px, ${indicator.top}px) scaleX(${indicator.width / TAB_INDICATOR_BASE})`,
          }}
        />
      )}
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Trigger
>): React.ReactElement {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative z-[1] inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-ui font-medium ring-offset-background transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:font-semibold data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Content
>): React.ReactElement {
  return (
    <TabsPrimitive.Content
      className={cn(
        'pf-content-reveal ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    />
  );
}
