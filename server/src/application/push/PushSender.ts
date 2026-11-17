import type { PushSubscription } from '../../domain/push/PushSubscription.js';

export type VapidCredentials = {
  readonly publicKey: string;
  readonly privateKey: string;
  // https: or mailto: contact of the sender, required by push services (Apple included).
  readonly subject: string;
};

// gone: the subscription no longer exists (404/410) and must be deleted. failed: a transient or
// unknown error, the subscription is kept.
export type PushSendResult =
  | { readonly status: 'sent' }
  | { readonly status: 'gone'; readonly statusCode: number }
  | { readonly status: 'failed'; readonly statusCode: number | null; readonly message: string };

// Port delivering one push to one device. Implementation: WebPushSender (web-push package).
export interface PushSender {
  send(
    subscription: Pick<PushSubscription, 'endpoint' | 'keys'>,
    payload: string,
    vapid: VapidCredentials,
  ): Promise<PushSendResult>;
}
