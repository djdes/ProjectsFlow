import { createElement, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationTaskTarget } from '@/lib/notificationTaskTarget';
import { plainDescription } from '@/lib/taskTitleBody';
import { toast } from '@/components/ui/sonner';
import { showAssignedTaskToast } from '@/presentation/components/tasks/AssignedTaskToast';

// Window-событие, по которому счётчик непрочитанных делает мгновенный refresh.
export const NOTIFICATIONS_CHANGED_EVENT = 'pf:notifications-changed';

// «Тихие» realtime-события: задачи/проект изменились — UI рефетчит данные (без toast).
// detail.projectId — в каком проекте произошло изменение.
export const TASK_CHANGED_EVENT = 'pf:task-changed';
export const PROJECT_CHANGED_EVENT = 'pf:project-changed';
export const TASK_VERSION_CHANGED_EVENT = 'pf:task-version-changed';
// Общий realtime-SSE подключился или восстановился после обрыва. Компоненты с
// недолговечным состоянием перечитывают актуальный snapshot, чтобы не зависеть от
// события, которое могло произойти во время реконнекта.
export const REALTIME_CONNECTED_EVENT = 'pf:realtime-connected';
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
      kind: 'task_version_created';
      projectId: string;
      taskId: string;
      actorUserId: string | null;
      actorDisplayName: string | null;
      changedFields: string[];
      createdAt: string;
    }
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
  | { type: 'task_changed'; title: string; detail: string; projectName: string; actorDisplayName: string; projectId?: string; taskId?: string; commentId?: string; taskAvailable?: boolean }
  | { type: 'comment_mention'; projectName: string; actorDisplayName: string; projectId?: string; taskId?: string; commentId?: string }
  | { type: 'project_invite'; projectName: string; actorDisplayName: string }
  | { type: 'workspace_invite'; workspaceName: string; actorDisplayName: string }
  | { type: 'chat_mention'; workspaceName: string; actorDisplayName: string }
  | { type: 'join_request'; projectName: string; requesterDisplayName: string }
  // Задачу создали для человека или делегировали ему. Показываем не строку, а плашку с
  // действиями: узнать мало — надо иметь возможность сразу открыть или взять в работу.
  | {
      type: 'task_assignee_changed';
      taskId: string;
      projectId: string;
      projectName: string;
      taskExcerpt: string;
      actorDisplayName: string;
    };

function toastFor(payload: StreamPayload, navigate: (to: string) => void): void {
  const detail = payload.type === 'task_changed' ? plainDescription(payload.detail) : '';
  const preview = detail.length > 240 ? `${detail.slice(0, 240).trimEnd()}…` : detail;
  if (payload.type === 'task_changed' || payload.type === 'comment_mention') {
    const target = notificationTaskTarget(payload);
    if (target) {
      const title = payload.type === 'task_changed' ? payload.title : 'Вас упомянули в комментарии';
      const description = `${payload.actorDisplayName} · ${payload.projectName}` +
        (preview ? `\n${preview}` : '');
      const id = toast(createElement('button', {
        type: 'button', className: 'block w-full rounded-md text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:opacity-80',
        onClick: () => { toast.dismiss(id); navigate(target); },
      }, createElement('span', { className: 'block font-semibold' }, title),
      createElement('span', { className: 'block whitespace-pre-wrap text-sm font-normal' }, description)));
      return;
    }
  }
  switch (payload.type) {
    case 'task_changed':
      toast(payload.title, { description: `${payload.actorDisplayName} · ${payload.projectName}${preview ? `\n${preview}` : ''}` });
      break;
    case 'project_invite':
      toast(`${payload.actorDisplayName} пригласил вас в «${payload.projectName}»`);
      break;
    case 'workspace_invite':
      toast(`${payload.actorDisplayName} пригласил вас в пространство «${payload.workspaceName}»`);
      break;
    case 'comment_mention':
      toast(`${payload.actorDisplayName} упомянул вас в «${payload.projectName}»`);
      break;
    case 'chat_mention':
      toast(`${payload.actorDisplayName} упомянул вас в чате «${payload.workspaceName}»`);
      break;
    case 'join_request':
      toast(`${payload.requesterDisplayName} просит доступ к «${payload.projectName}»`);
      break;
    case 'task_assignee_changed':
      showAssignedTaskToast({
        taskId: payload.taskId,
        projectId: payload.projectId,
        projectName: payload.projectName,
        taskExcerpt: payload.taskExcerpt,
        actorDisplayName: payload.actorDisplayName,
      });
      break;
  }
}

// SSE-подписка на уведомления. При событии — toast + сигнал на refresh бейджа.
// EventSource сам переподключается при обрыве. Mount один раз на authenticated-сессию.
export function useNotificationStream(workspaceId: string): void {
  const navigate = useNavigate();
  useEffect(() => {
    let closed = false;
    const source = new EventSource(`/api/notifications/stream?workspaceId=${encodeURIComponent(workspaceId)}`, { withCredentials: true });

    source.addEventListener('open', () => {
      if (closed) return;
      window.dispatchEvent(new Event(REALTIME_CONNECTED_EVENT));
    });

    source.addEventListener('notification', (event) => {
      if (closed) return;
      try {
        const data = JSON.parse((event as MessageEvent).data) as { payload: StreamPayload };
        toastFor(data.payload, navigate);
      } catch {
        // битый payload — игнорируем, но бейдж всё равно обновим ниже.
      }
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
    });

    // «Тихие» доменные события — ретранслируем как window CustomEvent с projectId.
    // Страницы/провайдеры по ним рефетчат данные.
    source.addEventListener('realtime', (event) => {
      if (closed) return;
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
        if (data.kind === 'task_version_created') {
          window.dispatchEvent(
            new CustomEvent(TASK_VERSION_CHANGED_EVENT, { detail: data }),
          );
          // Фоновая правка могла пройти не через обычный HTTP-route задачи. Обновляем и канбан.
          window.dispatchEvent(
            new CustomEvent(TASK_CHANGED_EVENT, {
              detail: { projectId: data.projectId, taskId: data.taskId },
            }),
          );
          return;
        }
        const name = data.kind === 'project_changed' ? PROJECT_CHANGED_EVENT : TASK_CHANGED_EVENT;
        window.dispatchEvent(new CustomEvent(name, { detail: { projectId: data.projectId } }));
      } catch {
        // битый payload — игнорируем.
      }
    });

    return () => { closed = true; source.close(); };
  }, [workspaceId, navigate]);
}
