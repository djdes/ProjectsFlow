/** On-screen keyboard height from visualViewport; small differences (browser bars) count as none. */
export function keyboardInset(innerHeight: number, viewportHeight: number, offsetTop: number): number {
  const inset = innerHeight - viewportHeight - offsetTop;
  return inset > 120 ? Math.round(inset) : 0;
}
