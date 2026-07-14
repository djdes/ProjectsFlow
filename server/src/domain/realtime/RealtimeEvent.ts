// «Тихие» доменные события для live-обновления UI без перезагрузки. В отличие от
// уведомлений (Notification) они не показывают toast — клиент по ним рефетчит данные.
// comment_added несёт расширенный контекст — Ralph-диспетчер использует commentId/taskId
// чтобы мгновенно реагировать на новые комменты вместо 30-секундного polling'а.
export type RealtimeEvent =
  | { readonly kind: 'task_changed'; readonly projectId: string }
  | { readonly kind: 'project_changed'; readonly projectId: string }
  | {
      readonly kind: 'task_version_created';
      readonly projectId: string;
      readonly taskId: string;
      readonly actorUserId: string | null;
      readonly actorDisplayName: string | null;
      readonly changedFields: readonly string[];
      readonly createdAt: string;
    }
  | {
      readonly kind: 'comment_added';
      readonly projectId: string;
      readonly taskId: string;
      readonly commentId: string;
      readonly ownerUserId: string;
      // Кто оставил коммент: 'user' | 'agent' | 'system'. Клиент использует чтобы
      // отрисовать Claude-стиль для agent-комментов до полного рефетча. Optional —
      // старые серверы/события могут не присылать.
      readonly actorKind?: 'user' | 'agent' | 'system';
      readonly agentName?: string | null;
    }
  // Изменение статуса задачи (move или auto-return при ralph-answer). Несёт old/new,
  // чтобы клиент мог: перерисовать колонку, подсветить @mention'ы по awaiting_clarification,
  // а Ralph-диспетчер — мгновенно узнать что задача снова in_progress без polling'а.
  | {
      readonly kind: 'task_status_changed';
      readonly projectId: string;
      readonly taskId: string;
      readonly oldStatus: string;
      readonly newStatus: string;
      readonly actorUserId: string;
    }
  // LIVE-вкладка задачи: старт/финиш стрим-сессии Ralph-воркера. Несёт sessionId/status,
  // чтобы клиент отрисовал бейдж 🔴 на карточке (running) и погасил его в конце. Полный
  // firehose событий идёт НЕ сюда (per-user bus), а в task-scoped LiveEventHub (SSE /stream).
  | {
      readonly kind: 'live_session_changed';
      readonly projectId: string;
      readonly taskId: string;
      readonly sessionId: string;
      readonly status: 'running' | 'completed' | 'failed' | 'timeout' | 'canceled';
    }
  // Сохранён снимок мониторинга — страница «Мониторинг» мгновенно перекрашивает статус
  // без 15с-polling'а; полный снимок клиент догружает рефетчем. detail={projectId,serverId,status}.
  | {
      readonly kind: 'snapshot_stored';
      readonly projectId: string;
      readonly serverId: string;
      readonly status: string;
    }
  // Новое сообщение в общем чате пространства. Лёгкое событие для бейджа непрочитанного
  // 🔴 на кнопке «Чат» — полная лента идёт НЕ сюда (per-user bus), а в workspace-scoped
  // ChatEventHub (SSE /stream чата). Клиент по нему рефетчит/инкрементит счётчик.
  | {
      readonly kind: 'workspace_chat_changed';
      readonly workspaceId: string;
    };
