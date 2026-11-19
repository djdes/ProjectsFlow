import type { DevicePushPermission, DevicePushSubscription } from '@/domain/push/DevicePush';

export type DevicePushEnvironment = {
  // Service worker, PushManager and Notification are available.
  readonly supported: boolean;
  readonly ios: boolean;
  // Opened as an installed app (Home Screen).
  readonly standalone: boolean;
};

// Port for the browser's push capabilities on this device. Implementation: BrowserDevicePush
// (service worker + Push API + Notification API).
export interface DevicePush {
  environment(): DevicePushEnvironment;
  permission(): DevicePushPermission;
  // The system permission prompt. Call it straight from a tap handler: Safari shows the prompt
  // only in response to a user action.
  requestPermission(): Promise<DevicePushPermission>;
  current(): Promise<DevicePushSubscription | null>;
  subscribe(applicationServerKey: string): Promise<DevicePushSubscription>;
  unsubscribe(): Promise<void>;
}
