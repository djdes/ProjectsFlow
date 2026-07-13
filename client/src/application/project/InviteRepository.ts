import type { InviteAcceptResult, InvitePreview } from '@/domain/invite/InvitePreview';

// Anon-friendly: GET preview не требует логина, accept — требует. Dual-token:
// обслуживает и workspace-инвайты, и legacy project-инвайты (см. InvitePreview.kind).
// Используется страницей /invite/:token и кнопкой «Принять» в уведомлениях.
export interface InviteRepository {
  getPreview(token: string): Promise<InvitePreview>;
  accept(token: string): Promise<InviteAcceptResult>;
}
