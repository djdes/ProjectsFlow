// «Тихие» доменные события для live-обновления UI без перезагрузки. В отличие от
// уведомлений (Notification) они не показывают toast — клиент по ним рефетчит данные.
// comment_added несёт расширенный контекст — Ralph-диспетчер использует commentId/taskId
// чтобы мгновенно реагировать на новые комменты вместо 30-секундного polling'а.
export type RealtimeEvent =
  | { readonly kind: 'task_changed'; readonly projectId: string }
  | { readonly kind: 'project_changed'; readonly projectId: string }
  | {
      readonly kind: 'comment_added';
      readonly projectId: string;
      readonly taskId: string;
      readonly commentId: string;
      readonly ownerUserId: string;
    };
