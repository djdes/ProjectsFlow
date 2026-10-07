import { createHash } from 'node:crypto';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';
import type { InviteDelivery, InviteDeliveryStatus, WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { NotificationPayload } from '../../domain/notifications/Notification.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import { renderWorkspaceInviteEmail } from '../notifications/emails/workspaceInviteEmail.js';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const retryable = (status: InviteDeliveryStatus | undefined): boolean => !status || ['queued', 'failed', 'unavailable'].includes(status);

/** workspace_invites is the durable outbox. Side effects run after its transaction. */
export class DeliverWorkspaceInvites {
  private running = false;
  constructor(private readonly deps: {
    invites: WorkspaceInviteRepository;
    workspaces: { getById(id: string): Promise<{ name: string } | null> };
    users: { getById(id: string): Promise<{ displayName: string } | null>; getByEmail(email: string): Promise<{ id: string } | null> };
    notifications: { create(input: { id: string; userId: string; payload: NotificationPayload }): Promise<unknown> };
    email: EmailSender; emailConfigured: boolean;
    telegram: Pick<SendAgentTelegramNotification, 'execute'>;
    appUrl: string; now: () => Date;
  }) {}

  wake = (): void => { void this.run().catch(error => console.error('[workspace-invite-delivery]', error instanceof Error ? error.name : 'failed')); };

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let n = 0; n < 20; n++) {
        const invite = await this.deps.invites.claimDelivery(this.deps.now());
        if (!invite) break;
        await this.deliver(invite);
      }
    } finally { this.running = false; }
  }

  private async deliver(invite: WorkspaceInvite): Promise<void> {
    const delivery: InviteDelivery = { ...invite.delivery };
    try {
      const workspace = await this.deps.workspaces.getById(invite.workspaceId);
      if (!workspace || !invite.email) {
        await this.deps.invites.finishDelivery(invite.id, invite.deliveryLockedAt!, delivery, null);
        return;
      }
      const actor = await this.deps.users.getById(invite.createdByUserId);
      const actorDisplayName = actor?.displayName ?? 'Участник пространства';
      const acceptUrl = `${this.deps.appUrl.replace(/\/$/, '')}/invite/${invite.token}`;
      // Look-up failure must not prevent the independent email channel.
      const recipient = retryable(delivery.site) || retryable(delivery.telegram) ? this.deps.users.getByEmail(invite.email) : Promise.resolve(null);
      const send = async (channel: keyof InviteDelivery, action: () => Promise<InviteDeliveryStatus>): Promise<void> => {
        if (!retryable(delivery[channel])) return;
        try { delivery[channel] = await action(); }
        catch { delivery[channel] = 'failed'; }
      };
      await Promise.all([
        send('email', async () => {
          if (!this.deps.emailConfigured) return 'unavailable';
          await this.deps.email.send(renderWorkspaceInviteEmail({ to: invite.email!, workspaceName: workspace.name, actorDisplayName, role: invite.role, acceptUrl }));
          return 'sent';
        }),
        send('site', async () => {
          const user = await recipient;
          if (!user) return 'not_registered';
          try {
            // A deterministic id makes a retry safe after a lost acknowledgement.
            const hash = createHash('sha256').update(`${invite.id}:${invite.expiresAt.toISOString()}`).digest('hex');
            const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
            await this.deps.notifications.create({ id, userId: user.id, payload: {
              type: 'workspace_invite', workspaceId: invite.workspaceId, workspaceName: workspace.name,
              role: invite.role, inviteId: invite.id, token: invite.token,
              actorUserId: invite.createdByUserId, actorDisplayName,
            } });
          } catch (error) {
            const e = error as { code?: string; cause?: { code?: string } };
            if ((e.code ?? e.cause?.code) !== 'ER_DUP_ENTRY') throw error;
          }
          return 'sent';
        }),
        send('telegram', async () => {
          const user = await recipient;
          if (!user) return 'not_registered';
          const result = await this.deps.telegram.execute({
            userId: user.id, kind: 'workspace_invite', skipDedupCheck: true,
            text: `<b>Приглашение в пространство «${escapeHtml(workspace.name)}»</b>\n\n${escapeHtml(actorDisplayName)} приглашает вас в ProjectsFlow.\nРоль: ${invite.role === 'editor' ? 'Редактор' : 'Наблюдатель'}.\nДоступны проекты, выбранные для вас. Приглашение действует 7 дней.`,
            replyMarkup: { inline_keyboard: [[{ text: 'Принять приглашение', url: acceptUrl }]] },
          });
          if (result.status === 'ok') return 'sent';
          if (['not_connected', 'not_started', 'forbidden', 'pref_off'].includes(result.status)) return 'not_connected';
          return 'failed';
        }),
      ]);
      // Observe a rejected lookup even when site/TG were already sent on an earlier try.
      await recipient.catch(() => null);
    } catch {
      for (const channel of ['email', 'site', 'telegram'] as const) if (retryable(delivery[channel])) delivery[channel] = 'failed';
    }
    const attempts = invite.deliveryAttempts ?? 1;
    const delay = [60_000, 300_000, 900_000, 3_600_000][attempts - 1];
    const retryAt = Object.values(delivery).some(retryable) && delay !== undefined ? new Date(this.deps.now().getTime() + delay) : null;
    await this.deps.invites.finishDelivery(invite.id, invite.deliveryLockedAt!, delivery, retryAt);
  }
}
