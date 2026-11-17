// Web Push (db/184): a device subscription. The browser issues it after pushManager.subscribe():
// endpoint is the browser's push service URL, keys encrypt the payload (RFC 8291). A
// subscription belongs to one person; the same endpoint sent by another account moves to that
// account (it is the same device).

export const PUSH_ENDPOINT_MAX_LENGTH = 1000;

export type PushSubscriptionKeys = {
  readonly p256dh: string;
  readonly auth: string;
};

export type PushSubscription = {
  readonly userId: string;
  readonly endpoint: string;
  readonly keys: PushSubscriptionKeys;
  readonly userAgent: string | null;
};

// Push payload, read by the client service worker (client/public/sw.js): title and body go
// into the system notification, url opens on tap. workspaceId is the notification's workspace:
// an open app switches to it before navigating.
export type PushMessage = {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly workspaceId: string | null;
};

// The server POSTs to the endpoint itself, so only known push services are accepted: otherwise
// a subscription would let anyone make the server call into the internal network.
// Chrome, Android, Yandex and Opera use FCM; Firefox uses Mozilla; Safari and iPhone use Apple;
// Edge uses WNS.
const PUSH_SERVICE_HOSTS: readonly string[] = [
  'googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

export function isSupportedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length === 0 || endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
