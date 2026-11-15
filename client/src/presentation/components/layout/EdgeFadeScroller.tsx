import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useScrollEdges } from '@/presentation/components/tasks/inbox/useScrollEdges';

// Flags for `.pf-fade-x` (globals.css): which edges of a sideways ribbon still hide content.
// For rows that already own their element (a toolbar with its own handlers) — spread the
// result onto it; otherwise use <EdgeFadeScroller>.
export type EdgeFadeProps = { 'data-fade-start'?: ''; 'data-fade-end'?: '' };

export function useEdgeFade(): readonly [(element: HTMLElement | null) => void, EdgeFadeProps] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const { back, forward } = useScrollEdges(element);
  const fadeProps: EdgeFadeProps = {
    ...(back ? { 'data-fade-start': '' as const } : {}),
    ...(forward ? { 'data-fade-end': '' as const } : {}),
  };
  return [setElement, fadeProps] as const;
}

// A row that scrolls sideways without a scrollbar and dissolves at the edge that hides
// content, so a cut-off item reads as «there is more», not as a clipped layout.
export function EdgeFadeScroller({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  const [attach, fadeProps] = useEdgeFade();
  return (
    <div
      ref={attach}
      {...fadeProps}
      {...rest}
      className={cn('pf-fade-x pf-scrollbar-hide overflow-x-auto overscroll-x-contain', className)}
    >
      {children}
    </div>
  );
}
