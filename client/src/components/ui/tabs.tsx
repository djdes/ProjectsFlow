import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

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
    right: number;
    top: number;
    height: number;
    direction: 'left' | 'right';
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
        right:
          element.clientWidth - (rect.right - parent.left + element.scrollLeft),
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
          : {
              ...next,
              direction:
                previous && next.left < previous.left ? 'left' : 'right',
            },
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
        'pf-tabs relative isolate inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
      {...props}
    >
      {indicator && (
        <span
          aria-hidden="true"
          data-direction={indicator.direction}
          className="pf-tab-indicator pointer-events-none absolute rounded-md bg-background shadow-sm"
          style={{
            left: indicator.left,
            right: indicator.right,
            top: indicator.top,
            height: indicator.height,
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
        'relative z-[1] inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground',
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
