/** On-screen keyboard height from visualViewport; small differences (browser bars) count as none. */
export function keyboardInset(innerHeight: number, viewportHeight: number, offsetTop: number): number {
  const inset = innerHeight - viewportHeight - offsetTop;
  return inset > 120 ? Math.round(inset) : 0;
}

export function hasKeyboardFocus(): boolean {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || field.inputMode === 'none') return false;
  if (field instanceof HTMLInputElement) {
    return !field.readOnly && !field.disabled &&
      ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(field.type);
  }
  if (field instanceof HTMLTextAreaElement) return !field.readOnly && !field.disabled;
  return field.isContentEditable;
}
