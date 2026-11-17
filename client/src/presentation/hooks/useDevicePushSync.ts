import { useEffect } from 'react';
import { useContainer } from '@/infrastructure/di/container';

let syncedThisLoad = false;

// Once per app start: this device's subscription (if push is on here) is sent to the server
// again. After an account change it moves to the current account, after a server key change the
// browser resubscribes. Errors are not shown: this is a background sync.
export function useDevicePushSync(): void {
  const { devicePushNotifications } = useContainer();
  useEffect(() => {
    if (syncedThisLoad) return;
    syncedThisLoad = true;
    devicePushNotifications.sync().catch((error: unknown) => {
      console.warn('[push] device subscription sync failed', error);
    });
  }, [devicePushNotifications]);
}
