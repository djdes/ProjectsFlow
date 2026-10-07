export function motionEnabled(
  preference: string | null,
  reducedMotion: boolean,
): boolean {
  return preference !== 'off' && !reducedMotion;
}
