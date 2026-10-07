/** A short intentional flick closes; jitter, a held drag and horizontal swipes do not. */
export function shouldDismissSheet(
  distance: number,
  velocity: number,
  height: number,
): boolean {
  return (
    distance >= Math.min(120, Math.max(64, height * 0.2)) ||
    (distance >= 32 && velocity >= 0.55)
  );
}

/** Only take over a downward gesture when every scroll owner is already at the top. */
export function canDragSheetFrom(target: Element, sheet: HTMLElement): boolean {
  if (!sheet.contains(target)) return false;
  if (target.closest('[data-pf-sheet-handle]')) return true;
  if (
    target.closest(
      'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role^="menuitem"], [data-pf-no-swipe]',
    )
  )
    return false;
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (
      el.scrollTop > 0 &&
      el.scrollHeight > el.clientHeight + 1 &&
      /auto|scroll/.test(getComputedStyle(el).overflowY)
    )
      return false;
    if (el === sheet) break;
  }
  return true;
}
