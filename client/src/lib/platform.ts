// Device platform for PWA flows: installing to the Home Screen, push notifications.

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ pretends to be a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && typeof document !== 'undefined' && 'ontouchend' in document);
}

export function isAndroidDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent || '');
}

// Opened as an installed app rather than a browser tab.
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari: non-standard navigator.standalone.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
