import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  CreateCampaignResult,
  MailingRepository,
  MailingTemplateInput,
  MailingWorkspaceOption,
  NewMailingCampaign,
} from '../../application/mailing/MailingRepository.js';
import {
  emptyMailingCounts,
  type MailingAudience,
  type MailingCampaign,
  type MailingCandidate,
  type MailingDelivery,
  type MailingRecipientFailure,
  type MailingRecipientStatus,
  type MailingTemplate,
} from '../../domain/mailing/Mailing.js';
import { effectiveMailingPlan, parseMailingAudience } from '../../domain/mailing/audience.js';
import { parseJsonCol } from './jsonCol.js';

type TemplateRow = RowDataPacket & {
  id: string; name: string; subject: string; preheader: string; body_markdown: string;
  cta_label: string | null; cta_url: string | null; created_by: string; created_at: Date; updated_at: Date;
};
type CampaignRow = RowDataPacket & {
  id: string; template_id: string | null; name: string; subject: string; preheader: string; body_markdown: string;
  cta_label: string | null; cta_url: string | null; audience: unknown; status: MailingCampaign['status'];
  total_count: number; created_by: string; created_at: Date; finished_at: Date | null; cancelled_at: Date | null;
};
type CandidateRow = RowDataPacket & {
  id: string; email: string; display_name: string; workspace_name: string | null;
  plan: 'free' | 'prime' | 'vip'; subscription_expires_at: Date | null;
};

const toTemplate = (r: TemplateRow): MailingTemplate => ({
  id: r.id, name: r.name, subject: r.subject, preheader: r.preheader, bodyMarkdown: r.body_markdown,
  ctaLabel: r.cta_label, ctaUrl: r.cta_url, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

const RECIPIENT_COLUMNS = 'campaign_id,user_id,email,display_name,workspace_name';
const INSERT_CHUNK = 500;

export class MysqlMailingRepository implements MailingRepository {
  constructor(private readonly pool: Pool) {}

  // --- templates ---

  async listTemplates(): Promise<MailingTemplate[]> {
    const [rows] = await this.pool.query<TemplateRow[]>('SELECT * FROM mailing_templates ORDER BY updated_at DESC, id');
    return rows.map(toTemplate);
  }

  async getTemplate(id: string): Promise<MailingTemplate | null> {
    const [rows] = await this.pool.query<TemplateRow[]>('SELECT * FROM mailing_templates WHERE id=?', [id]);
    return rows[0] ? toTemplate(rows[0]) : null;
  }

  async createTemplate(id: string, t: MailingTemplateInput, createdBy: string): Promise<MailingTemplate> {
    await this.pool.query(
      `INSERT INTO mailing_templates (id,name,subject,preheader,body_markdown,cta_label,cta_url,created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, t.name, t.subject, t.preheader, t.bodyMarkdown, t.ctaLabel, t.ctaUrl, createdBy],
    );
    const created = await this.getTemplate(id);
    if (!created) throw new Error('Failed to read back mailing template');
    return created;
  }

  async updateTemplate(id: string, t: MailingTemplateInput): Promise<MailingTemplate | null> {
    await this.pool.query(
      `UPDATE mailing_templates SET name=?,subject=?,preheader=?,body_markdown=?,cta_label=?,cta_url=? WHERE id=?`,
      [t.name, t.subject, t.preheader, t.bodyMarkdown, t.ctaLabel, t.ctaUrl, id],
    );
    return this.getTemplate(id);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const [r] = await this.pool.query<ResultSetHeader>('DELETE FROM mailing_templates WHERE id=?', [id]);
    return r.affectedRows > 0;
  }

  // --- audience ---

  async listWorkspaceOptions(): Promise<MailingWorkspaceOption[]> {
    const [rows] = await this.pool.query<(RowDataPacket & { id: string; name: string; member_count: number })[]>(
      `SELECT w.id, w.name, COUNT(u.id) AS member_count FROM workspaces w
       JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL
       WHERE w.kind='team' GROUP BY w.id, w.name ORDER BY w.name, w.id`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, memberCount: Number(r.member_count) }));
  }

  async workspaceExists(id: string): Promise<boolean> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT 1 FROM workspaces WHERE id=? LIMIT 1', [id]);
    return rows.length > 0;
  }

  async listAudienceCandidates(audience: MailingAudience, now: Date): Promise<MailingCandidate[]> {
    // {{workspace}} is the audience's workspace when one is chosen, else the user's current one.
    const [rows] = audience.kind === 'workspace'
      ? await this.pool.query<CandidateRow[]>(
        `SELECT u.id,u.email,u.display_name,w.name AS workspace_name,u.plan,u.subscription_expires_at
         FROM workspace_members m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id
         WHERE m.workspace_id=? AND u.deleted_at IS NULL ORDER BY u.created_at, u.id`, [audience.workspaceId])
      : await this.pool.query<CandidateRow[]>(
        `SELECT u.id,u.email,u.display_name,w.name AS workspace_name,u.plan,u.subscription_expires_at
         FROM users u LEFT JOIN workspaces w ON w.id=u.current_workspace_id
         WHERE u.deleted_at IS NULL ORDER BY u.created_at, u.id`);
    const plans = audience.kind === 'plan' ? new Set(audience.plans) : null;
    return rows
      .filter((r) => !plans || plans.has(effectiveMailingPlan(r.plan, r.subscription_expires_at, now)))
      .map((r) => ({ userId: r.id, email: r.email, displayName: r.display_name, workspaceName: r.workspace_name }));
  }

  async listUnsubscribedUserIds(): Promise<Set<string>> {
    const [rows] = await this.pool.query<(RowDataPacket & { user_id: string })[]>('SELECT user_id FROM mailing_unsubscribes');
    return new Set(rows.map((r) => r.user_id));
  }

  async isUnsubscribed(userId: string): Promise<boolean> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT 1 FROM mailing_unsubscribes WHERE user_id=? LIMIT 1', [userId]);
    return rows.length > 0;
  }

  async unsubscribe(userId: string, now: Date): Promise<boolean> {
    const [r] = await this.pool.query<ResultSetHeader>(
      `INSERT IGNORE INTO mailing_unsubscribes (user_id,email,created_at)
       SELECT id,email,? FROM users WHERE id=?`, [now, userId]);
    return r.affectedRows > 0 || (await this.isUnsubscribed(userId));
  }

  async findRecipient(userId: string): Promise<MailingCandidate | null> {
    const [rows] = await this.pool.query<CandidateRow[]>(
      `SELECT u.id,u.email,u.display_name,w.name AS workspace_name,u.plan,u.subscription_expires_at
       FROM users u LEFT JOIN workspaces w ON w.id=u.current_workspace_id WHERE u.id=? AND u.deleted_at IS NULL`, [userId]);
    const r = rows[0];
    return r ? { userId: r.id, email: r.email, displayName: r.display_name, workspaceName: r.workspace_name } : null;
  }

  // --- campaigns ---

  async createCampaign(input: NewMailingCampaign, now: Date): Promise<CreateCampaignResult> {
    const conn: PoolConnection = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query<ResultSetHeader>(
        `INSERT IGNORE INTO mailing_campaigns
         (id,template_id,name,subject,preheader,body_markdown,cta_label,cta_url,audience,request_hash,status,total_count,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'sending',?,?,?)`,
        [input.id, input.templateId, input.name, input.content.subject, input.content.preheader, input.content.bodyMarkdown,
          input.content.ctaLabel, input.content.ctaUrl, JSON.stringify(input.audience), input.requestHash,
          input.recipients.length, input.createdBy, now],
      );
      if (r.affectedRows === 0) {
        await conn.rollback();
        const [existing, hash] = await Promise.all([this.getCampaign(input.id), this.getCampaignRequestHash(input.id)]);
        if (!existing || hash === null) throw new Error('mailing campaign vanished after a duplicate insert');
        return { kind: 'exists', campaign: existing, requestHash: hash };
      }
      for (let i = 0; i < input.recipients.length; i += INSERT_CHUNK) {
        const chunk = input.recipients.slice(i, i + INSERT_CHUNK);
        await conn.query(
          `INSERT IGNORE INTO mailing_recipients (${RECIPIENT_COLUMNS}) VALUES ${chunk.map(() => '(?,?,?,?,?)').join(',')}`,
          chunk.flatMap((c) => [input.id, c.userId, c.email, c.displayName.slice(0, 80), c.workspaceName?.slice(0, 120) ?? null]),
        );
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
    const campaign = await this.getCampaign(input.id);
    if (!campaign) throw new Error('Failed to read back mailing campaign');
    return { kind: 'created', campaign };
  }

  private async withCounts(rows: CampaignRow[]): Promise<MailingCampaign[]> {
    if (rows.length === 0) return [];
    const [counts] = await this.pool.query<(RowDataPacket & { campaign_id: string; status: MailingRecipientStatus; n: number })[]>(
      `SELECT campaign_id,status,COUNT(*) AS n FROM mailing_recipients WHERE campaign_id IN (?) GROUP BY campaign_id,status`,
      [rows.map((r) => r.id)],
    );
    return rows.map((r) => {
      const c = emptyMailingCounts();
      for (const row of counts) if (row.campaign_id === r.id) c[row.status] = Number(row.n);
      return {
        id: r.id, templateId: r.template_id, name: r.name,
        content: { subject: r.subject, preheader: r.preheader, bodyMarkdown: r.body_markdown, ctaLabel: r.cta_label, ctaUrl: r.cta_url },
        audience: parseMailingAudience(parseJsonCol<unknown>(r.audience, null)) ?? { kind: 'all' },
        status: r.status, totalCount: Number(r.total_count), counts: c, createdBy: r.created_by,
        createdAt: r.created_at, finishedAt: r.finished_at, cancelledAt: r.cancelled_at,
      };
    });
  }

  async listCampaigns(limit: number): Promise<MailingCampaign[]> {
    const [rows] = await this.pool.query<CampaignRow[]>('SELECT * FROM mailing_campaigns ORDER BY created_at DESC, id LIMIT ?', [limit]);
    return this.withCounts(rows);
  }

  async getCampaign(id: string): Promise<MailingCampaign | null> {
    const [rows] = await this.pool.query<CampaignRow[]>('SELECT * FROM mailing_campaigns WHERE id=?', [id]);
    return (await this.withCounts(rows))[0] ?? null;
  }

  async getCampaignRequestHash(id: string): Promise<string | null> {
    const [rows] = await this.pool.query<(RowDataPacket & { request_hash: string })[]>(
      'SELECT request_hash FROM mailing_campaigns WHERE id=?', [id]);
    return rows[0]?.request_hash ?? null;
  }

  async listRecipientProblems(campaignId: string, limit: number): Promise<MailingRecipientFailure[]> {
    const [rows] = await this.pool.query<(RowDataPacket & { email: string; display_name: string; status: 'failed' | 'skipped'; error: string | null })[]>(
      `SELECT email,display_name,status,error FROM mailing_recipients
       WHERE campaign_id=? AND status IN ('failed','skipped') ORDER BY email LIMIT ?`, [campaignId, limit]);
    return rows.map((r) => ({ email: r.email, displayName: r.display_name, status: r.status, error: r.error }));
  }

  async cancelCampaign(id: string, now: Date): Promise<boolean> {
    const [r] = await this.pool.query<ResultSetHeader>(
      `UPDATE mailing_campaigns SET status='cancelled', cancelled_at=?, finished_at=? WHERE id=? AND status='sending'`, [now, now, id]);
    if (r.affectedRows === 0) return false;
    await this.pool.query(`UPDATE mailing_recipients SET status='cancelled' WHERE campaign_id=? AND status='queued'`, [id]);
    return true;
  }

  // --- queue ---

  async failStaleClaims(before: Date, error: string): Promise<number> {
    const [r] = await this.pool.query<ResultSetHeader>(
      `UPDATE mailing_recipients SET status='failed', error=?, locked_at=NULL WHERE status='sending' AND locked_at<?`, [error, before]);
    return r.affectedRows;
  }

  async countSentSince(since: Date): Promise<number> {
    const [rows] = await this.pool.query<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM mailing_recipients WHERE (status='sent' AND sent_at>=?) OR status='sending'`, [since]);
    return Number(rows[0]?.n ?? 0);
  }

  async claimDue(now: Date, limit: number): Promise<MailingDelivery[]> {
    const [candidates] = await this.pool.query<(RowDataPacket & { campaign_id: string; user_id: string })[]>(
      `SELECT r.campaign_id,r.user_id FROM mailing_recipients r JOIN mailing_campaigns c ON c.id=r.campaign_id
       WHERE r.status='queued' AND c.status='sending' AND (r.next_attempt_at IS NULL OR r.next_attempt_at<=?)
       ORDER BY c.created_at, r.campaign_id, r.next_attempt_at, r.user_id LIMIT ?`, [now, limit]);
    if (candidates.length === 0) return [];
    // Second precision: TIMESTAMP columns drop milliseconds, the finish compares exactly.
    const lockedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
    const claimed: Array<{ campaign_id: string; user_id: string }> = [];
    for (const c of candidates) {
      const [r] = await this.pool.query<ResultSetHeader>(
        `UPDATE mailing_recipients SET status='sending', locked_at=?, attempts=attempts+1
         WHERE campaign_id=? AND user_id=? AND status='queued'`, [lockedAt, c.campaign_id, c.user_id]);
      if (r.affectedRows === 1) claimed.push(c);
    }
    if (claimed.length === 0) return [];
    const [rows] = await this.pool.query<(RowDataPacket & {
      campaign_id: string; user_id: string; email: string; display_name: string; workspace_name: string | null; attempts: number;
      subject: string; preheader: string; body_markdown: string; cta_label: string | null; cta_url: string | null;
    })[]>(
      `SELECT r.campaign_id,r.user_id,r.email,r.display_name,r.workspace_name,r.attempts,
              c.subject,c.preheader,c.body_markdown,c.cta_label,c.cta_url
       FROM mailing_recipients r JOIN mailing_campaigns c ON c.id=r.campaign_id
       WHERE r.status='sending' AND r.locked_at=? AND (r.campaign_id,r.user_id) IN (${claimed.map(() => '(?,?)').join(',')})`,
      [lockedAt, ...claimed.flatMap((c) => [c.campaign_id, c.user_id])],
    );
    return rows.map((r) => ({
      campaignId: r.campaign_id, userId: r.user_id, email: r.email, displayName: r.display_name, workspaceName: r.workspace_name,
      attempts: Number(r.attempts), lockedAt,
      content: { subject: r.subject, preheader: r.preheader, bodyMarkdown: r.body_markdown, ctaLabel: r.cta_label, ctaUrl: r.cta_url },
    }));
  }

  private async finish(d: MailingDelivery, set: string, params: unknown[]): Promise<void> {
    await this.pool.query(
      `UPDATE mailing_recipients SET ${set}, locked_at=NULL WHERE campaign_id=? AND user_id=? AND status='sending' AND locked_at=?`,
      [...params, d.campaignId, d.userId, d.lockedAt],
    );
  }

  markSent(d: MailingDelivery, now: Date): Promise<void> {
    return this.finish(d, `status='sent', sent_at=?, error=NULL`, [now]);
  }

  async markRetry(d: MailingDelivery, at: Date, error: string): Promise<void> {
    await this.finish(d, `status='queued', next_attempt_at=?, error=?`, [at, error]);
    // A campaign cancelled while this letter was in flight must not get it back in the queue.
    await this.pool.query(
      `UPDATE mailing_recipients r JOIN mailing_campaigns c ON c.id=r.campaign_id SET r.status='cancelled'
       WHERE r.campaign_id=? AND r.user_id=? AND r.status='queued' AND c.status='cancelled'`, [d.campaignId, d.userId]);
  }

  markFailed(d: MailingDelivery, error: string): Promise<void> {
    return this.finish(d, `status='failed', error=?`, [error]);
  }

  markSkipped(d: MailingDelivery, reason: string): Promise<void> {
    return this.finish(d, `status='skipped', error=?`, [reason]);
  }

  async completeDrained(now: Date): Promise<number> {
    const [r] = await this.pool.query<ResultSetHeader>(
      `UPDATE mailing_campaigns c SET c.status='completed', c.finished_at=?
       WHERE c.status='sending' AND NOT EXISTS (
         SELECT 1 FROM mailing_recipients r WHERE r.campaign_id=c.id AND r.status IN ('queued','sending'))`, [now]);
    return r.affectedRows;
  }
}
