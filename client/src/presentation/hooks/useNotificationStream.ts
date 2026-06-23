import { useEffect } from 'react';
import { toast } from '@/components/ui/sonner';

// Window-событие, по которому счётчик непрочитанных делает мгновенный refresh.
export const NOTIFICATIONS_CHANGED_EVENT = 'pf:notifications-changed';

// «Тихие» realtime-события: задачи/проект изменились — UI рефетчит данные (без toast).
// detail.projectId — в каком проекте произошло изменение.
export const TASK_CHANGED_EVENT = 'pf:task-changed';
export const PROJECT_CHANGED_EVENT = 'pf:project-changed';
// Сменилось состояние LIVE-сессии воркера (start/finish). Канбан рисует 🔴 на карточке,
// открытая LIVE-вкладка обновляет список сессий. detail = {projectId,taskId,sessionId,status}.
export const LIVE_CHANGED_EVENT = 'pf:live-changed';
// Сохранён снимок мониторинга — страница «Мониторинг» рефетчит/перекрашивает. detail={projectId,serverId,status}.
export const MONITORING_CHANGED_EVENT = 'pf:monitoring-changed';
// Новое сообщение в чате пространства — бейдж непрочитанного на кнопке «Чат» рефетчит счётчик.
// detail={workspaceId}. Полную ленту обновляет открытая SSE-вкладка чата (отдельный EventSource).
export const CHAT_CHANGED_EVENT = 'pf:chat-changed';

type LiveSessionStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'canceled';

type RealtimeEvent =
  | { kind: 'task_changed' | 'project_changed'; projectId: string }
  | {
      kind: 'live_session_changed';
      projectId: string;
      taskId: string;
      sessionId: string;
      status: LiveSessionStatus;
    }
  | { kind: 'snapshot_stored'; projectId: string; serverId: string; status: string }
  | { kind: 'workspace_chat_changed'; workspaceId: string };

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

    // «Тихие» доменные события — ретранслируем как window CustomEvent с projectId.
    // Страницы/провайдеры по ним рефетчат данные.
    source.addEventListener('realtime', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as RealtimeEvent;
        if (data.kind === 'live_session_changed') {
          // Бейдж 🔴 на карточке + рефреш открытой LIVE-вкладки. Кладём весь detail
          // (taskId/sessionId/status), слушатели матчат по projectId+taskId.
          window.dispatchEvent(
            new CustomEvent(LIVE_CHANGED_EVENT, {
              detail: {
                projectId: data.projectId,
                taskId: data.taskId,
                sessionId: data.sessionId,
                status: data.status,
              },
            }),
          );
          return;
        }
        if (data.kind === 'snapshot_stored') {
          window.dispatchEvent(
            new CustomEvent(MONITORING_CHANGED_EVENT, {
              detail: { projectId: data.projectId, serverId: data.serverId, status: data.status },
            }),
          );
          return;
        }
        if (data.kind === 'workspace_chat_changed') {
          window.dispatchEvent(
            new CustomEvent(CHAT_CHANGED_EVENT, { detail: { workspaceId: data.workspaceId } }),
          );
          return;
        }
        const name = data.kind === 'project_changed' ? PROJECT_CHANGED_EVENT : TASK_CHANGED_EVENT;
        window.dispatchEvent(new CustomEvent(name, { detail: { projectId: data.projectId } }));
      } catch {
        // битый payload — игнорируем.
      }
    });

    return () => source.close();
  }, []);
}
