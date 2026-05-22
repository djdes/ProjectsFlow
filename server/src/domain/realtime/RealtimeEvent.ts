// «Тихие» доменные события для live-обновления UI без перезагрузки. В отличие от
// уведомлений (Notification) они не показывают toast — клиент по ним рефетчит данные.
export type RealtimeEvent =
  | { readonly kind: 'task_changed'; readonly projectId: string }
  | { readonly kind: 'project_changed'; readonly projectId: string };
