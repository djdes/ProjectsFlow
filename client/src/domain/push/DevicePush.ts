// "Notifications on this device" (Web Push). A subscription is what the browser returns from
// pushManager.subscribe(): the push service URL and the encryption keys. applicationServerKey is
// the server public key it is bound to (null when the browser does not report it).
export type DevicePushSubscription = {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly applicationServerKey: string | null;
};

export type DevicePushPermission = 'default' | 'granted' | 'denied';

// What the profile shows:
// - unsupported: the browser has no push (ios: an old iOS, 16.4+ is required);
// - needs_home_screen: iPhone/iPad in Safari, push works only in the app added to the Home Screen;
// - denied: notifications are blocked in the browser or phone settings;
// - ready: can be switched on and off; enabled means on for this device.
export type DevicePushState =
  | { readonly kind: 'unsupported'; readonly ios: boolean }
  | { readonly kind: 'needs_home_screen' }
  | { readonly kind: 'denied'; readonly ios: boolean }
  | { readonly kind: 'ready'; readonly enabled: boolean };
