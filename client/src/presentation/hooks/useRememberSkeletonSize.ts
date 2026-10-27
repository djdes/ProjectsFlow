import { useEffect, type DependencyList, type RefObject } from 'react';
import { rememberSkeletonSize } from '@/lib/loadingLayout';

/**
 * Remembers the summed height of the elements for the next loading skeleton of this
 * screen (lib/loadingLayout.ts). `deps` must change whenever the elements are replaced.
 */
export function useRememberSkeletonSize(
  scope: string | null,
  name: string,
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
  deps: DependencyList,
): void {
  useEffect(() => {
    const elements = refs
      .map((ref) => ref.current)
      .filter((element): element is HTMLElement => element !== null);
    if (!scope || elements.length === 0 || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      rememberSkeletonSize(
        scope,
        name,
        elements.reduce((sum, element) => sum + element.getBoundingClientRect().height, 0),
      );
    });
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable, deps say when they change
  }, [scope, name, ...deps]);
}
