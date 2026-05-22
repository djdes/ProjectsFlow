import { useEffect } from 'react';
import { toast } from '@/components/ui/sonner';

// Window-событие, по которому счётчик непрочитанных делает мгновенный refresh.
export const NOTIFICATIONS_CHANGED_EVENT = 'pf:notifications-changed';

type StreamPayload =
  | { type: 'comment_mention'; projectName: string; actorDisplayName: string }
  | { type: 'project_invite'; projectName: string; actorDisplayName: string }
  | { type: 'join_request'; projectName: string; requesterDisplayName: string };

function toastFor(payload: StreamPayload): void {
  switch (payload.type) {
    case 'project_invite':
      toast(`${payload.actorDisplayName} пригласил вас в «${payload.projectName}»`);
      break;
    case 'comment_mention':
      toast(`${payload.actorDisplayName} упомянул вас в «${payload.projectName}»`);
      break;
    case 'join_request':
      toast(`${payload.requesterDisplayName} просит доступ к «${payload.projectName}»`);
      break;
  }
}

// SSE-подписка на уведомления. При событии — toast + сигнал на refresh бейджа.
// EventSource сам переподключается при обрыве. Mount один раз на authenticated-сессию.
export function useNotificationStream(): void {
  useEffect(() => {
    const source = new EventSource('/api/notifications/stream', { withCredentials: true });

    source.addEventListener('notification', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { payload: StreamPayload };
        toastFor(data.payload);
      } catch {
        // битый payload — игнорируем, но бейдж всё равно обновим ниже.
      }
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
    });

    return () => source.close();
  }, []);
}
