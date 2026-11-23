export const PULL_REFRESH_THRESHOLD = 64;
export function pullRefreshDistance(dx: number, dy: number): number {
  if (dy <= 0 || Math.abs(dx) > dy) return 0;
  return Math.min(88, dy * 0.45);
}
export function mayStartPull(target: Element, main: HTMLElement): boolean {
  if (!main.contains(target) || window.getSelection()?.isCollapsed === false)
    return false;
  // Real controls keep their touch. Task cards are role="button" blocks that fill almost the
  // whole inbox: a pull may start on them (a held press is a drag — AppExperience checks that).
  if (
    main.scrollTop > 1 ||
    target.closest(
      'button, a, input, textarea, select, [contenteditable], [data-pf-no-edge-swipe]',
    )
  )
    return false;
  let element: Element | null = target;
  while (element && element !== main) {
    if (
      element instanceof HTMLElement &&
      element.scrollHeight > element.clientHeight + 1 &&
      /auto|scroll/.test(getComputedStyle(element).overflowY) &&
      element.scrollTop > 0
    )
      return false;
    element = element.parentElement;
  }
  return true;
}
