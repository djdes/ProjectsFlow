import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { MailingActor, MailingRepository } from '../../application/mailing/MailingRepository.js';
import {
  MailingError, emptyMailingCounts, normalizeMailingEmail,
  type AudienceUser, type ContactFilters, type MailingAudience, type MailingCampaign, type MailingCampaignSummary,
  type MailingContact, type MailingContactInput, type MailingDelivery, type MailingDraftInput,
  type MailingJob, type MailingPage, type MailingSettings, type MailingSuppression,
  type PlannedRecipient, type DeliveryStatus,
} from '../../domain/mailing/Mailing.js';

type Row = RowDataPacket;
type Connection = Pool | PoolConnection;
const PAGE_SIZE = 50;
const json = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : value) as T;
const iso = (value: unknown): string => (value instanceof Date ? value : new Date(String(value))).toISOString();
const nullableIso = (value: unknown): string | null => value ? iso(value) : null;
const str = (value: unknown): string => value == null ? '' : String(value);
const placeholder = (items: readonly unknown[]) => items.map(() => '?').join(',');
const dayStart = (now: Date): Date => new Date(Date.parse(`${new Date(now.getTime() + 10_800_000).toISOString().slice(0, 10)}T00:00:00+03:00`));
const COUNT_SELECT = `SELECT campaign_id, COUNT(*) total,
 SUM(status='queued') queued, SUM(status='sending') sending, SUM(status='sent') sent,
 SUM(status='failed') failed, SUM(status='skipped') skipped, SUM(status='cancelled') cancelled,
 SUM(clicked_at IS NOT NULL) clicks FROM mailing_deliveries GROUP BY campaign_id`;
const CAMPAIGN_SELECT = `SELECT c.*, counts.total, counts.queued, counts.sending, counts.sent,
 counts.failed, counts.skipped, counts.cancelled, counts.clicks
 FROM mailing_campaigns c LEFT JOIN (${COUNT_SELECT}) counts ON counts.campaign_id=c.id`;
function campaignSummary(row: Row): MailingCampaignSummary {
  const counts = emptyMailingCounts();
  for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] = Number(row[key] ?? 0);
  return { id: str(row.id), title: str(row.title), revision: Number(row.revision), status: row.status as MailingCampaign['status'],
    channels: json(row.channels_json),
    createdById: row.created_by_id ? str(row.created_by_id) : null, createdByName: str(row.created_by_name),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), scheduledAt: nullableIso(row.scheduled_at),
    startedAt: nullableIso(row.started_at), finishedAt: nullableIso(row.finished_at), counts };
}
function campaign(row: Row): MailingCampaign {
  return { ...campaignSummary(row), content: json(row.content_json), audience: json(row.audience_json) };
}
function contact(row: Row): MailingContact {
  return { id: str(row.id), email: str(row.email), name: str(row.name), company: str(row.company), source: str(row.source),
    status: row.status as MailingContact['status'], createdAt: iso(row.created_at), suppressed: Boolean(row.suppressed) };
}
function delivery(row: Row): MailingDelivery {
  return { id: str(row.id), campaignId: str(row.campaign_id), userId: row.user_id ? str(row.user_id) : null,
    contactId: row.contact_id ? str(row.contact_id) : null, email: row.email ? str(row.email) : null,
    name: str(row.name), company: str(row.company), channel: row.channel as MailingDelivery['channel'],
    status: row.status as DeliveryStatus, error: row.error ? str(row.error) : null, attempts: Number(row.attempts),
    sentAt: nullableIso(row.sent_at), clickedAt: nullableIso(row.clicked_at) };
}
function conflict(message = 'Черновик уже изменён. Откройте актуальную версию перед сохранением'): never {
  throw new MailingError('conflict', message, 409);
}

export class MysqlMailingRepository implements MailingRepository {
  constructor(private readonly pool: Pool) {}
  private async rows(sql: string, parameters: unknown[] = [], connection: Connection = this.pool): Promise<Row[]> {
    return (await connection.query<Row[]>(sql, parameters))[0];
  }
  private async write(sql: string, parameters: unknown[] = [], connection: Connection = this.pool): Promise<number> {
    return (await connection.query<ResultSetHeader>(sql, parameters))[0]!.affectedRows;
  }
  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async listUsers(): Promise<AudienceUser[]> {
    const rows = await this.rows(`SELECT u.id,u.display_name,u.email,u.plan,u.subscription_expires_at,u.created_at,
      (u.tg_chat_id IS NOT NULL AND u.tg_started_at IS NOT NULL) has_telegram,
      EXISTS(SELECT 1 FROM mailing_suppressions s WHERE s.email=u.email) suppressed
      FROM users u WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC,u.id`);
    const now = Date.now();
    return rows.map(row => ({ id: str(row.id), name: str(row.display_name), email: normalizeMailingEmail(str(row.email)),
      company: '', plan: row.subscription_expires_at && new Date(str(row.subscription_expires_at)).getTime() <= now ? 'free' : row.plan as AudienceUser['plan'],
      hasTelegram: Boolean(row.has_telegram), suppressed: Boolean(row.suppressed), createdAt: iso(row.created_at) }));
  }
  async listContacts(filters: ContactFilters, page: number): Promise<MailingPage<MailingContact>> {
    const where: string[] = []; const values: unknown[] = [];
    if (filters.search) { where.push('(name LIKE ? OR email LIKE ? OR company LIKE ?)'); values.push(...Array(3).fill(`%${filters.search}%`)); }
    if (filters.source) { where.push('source=?'); values.push(filters.source); }
    if (filters.status && filters.status !== 'all') { where.push('status=?'); values.push(filters.status); }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const rows = await this.rows(`SELECT c.*, EXISTS(SELECT 1 FROM mailing_suppressions s WHERE s.email=c.email) suppressed FROM mailing_contacts c${clause} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`, [...values, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const count = await this.rows(`SELECT COUNT(*) total FROM mailing_contacts${clause}`, values);
    return { items: rows.map(contact), total: Number(count[0]!.total), page, pageSize: PAGE_SIZE };
  }
  async contactBases() {
    return (await this.rows(`SELECT c.source, COUNT(*) total FROM mailing_contacts c WHERE c.status='active'
      AND NOT EXISTS(SELECT 1 FROM mailing_suppressions s WHERE s.email=c.email) GROUP BY c.source ORDER BY c.source`))
      .map(row => ({ source: str(row.source), total: Number(row.total) }));
  }
  async resolveContacts(selection: MailingAudience): Promise<MailingContact[]> {
    const sources = selection.baseIds.filter(id => id.startsWith('contacts:')).map(id => id.slice(9));
    const where: string[] = []; const values: string[] = [];
    if (selection.contactIds.length) { where.push(`c.id IN (${placeholder(selection.contactIds)})`); values.push(...selection.contactIds); }
    if (sources.length) { where.push(`c.source IN (${placeholder(sources)})`); values.push(...sources); }
    if (!where.length) return [];
    return (await this.rows(`SELECT c.*, EXISTS(SELECT 1 FROM mailing_suppressions s WHERE s.email=c.email) suppressed FROM mailing_contacts c WHERE (${where.join(' OR ')})`, values)).map(contact);
  }
  async importContacts(contacts: MailingContactInput[]) {
    return this.transaction(async connection => {
      let inserted = 0;
      for (let offset = 0; offset < contacts.length; offset += 100) {
        const chunk = contacts.slice(offset, offset + 100);
        const params = chunk.flatMap(c => [randomUUID(), c.email, c.name, c.company, c.source]);
        inserted += await this.write(`INSERT IGNORE INTO mailing_contacts (id,email,name,company,source) VALUES ${chunk.map(() => '(?,?,?,?,?)').join(',')}`, params, connection);
      }
      return { inserted, duplicates: contacts.length - inserted };
    });
  }
  async deleteContact(id: string): Promise<void> { await this.write('DELETE FROM mailing_contacts WHERE id=?', [id]); }
  async listSuppressions(search: string, page: number): Promise<MailingPage<MailingSuppression>> {
    const filter = search ? ' WHERE email LIKE ?' : ''; const values = search ? [`%${search}%`] : [];
    const rows = await this.rows(`SELECT * FROM mailing_suppressions${filter} ORDER BY created_at DESC,email LIMIT ? OFFSET ?`, [...values, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const count = await this.rows(`SELECT COUNT(*) total FROM mailing_suppressions${filter}`, values);
    return { items: rows.map(row => ({ email: str(row.email), reason: row.reason as MailingSuppression['reason'], createdAt: iso(row.created_at) })), total: Number(count[0]!.total), page, pageSize: PAGE_SIZE };
  }
  async suppress(email: string, reason: MailingSuppression['reason']): Promise<void> {
    await this.write('INSERT INTO mailing_suppressions (email,reason) VALUES (?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason)', [email, reason]);
  }
  async unsuppress(email: string): Promise<void> {
    await this.transaction(async connection => {
      await this.write('DELETE FROM mailing_suppressions WHERE email=?', [email], connection);
      await this.write("UPDATE mailing_contacts SET status='active' WHERE email=? AND status='unsubscribed'", [email], connection);
    });
  }
  async suppressed(emails: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let offset = 0; offset < emails.length; offset += 500) {
      const chunk = emails.slice(offset, offset + 500);
      for (const row of await this.rows(`SELECT email FROM mailing_suppressions WHERE email IN (${placeholder(chunk)})`, chunk)) found.add(str(row.email));
    }
    return found;
  }
  async settings(): Promise<MailingSettings> {
    const rows = await this.rows('SELECT * FROM mailing_settings WHERE id=1');
    return rows.length ? { enabled: Boolean(rows[0]!.enabled), perMinute: Number(rows[0]!.per_minute), perDay: Number(rows[0]!.per_day) } : { enabled: false, perMinute: 30, perDay: 1000 };
  }
  async saveSettings(settings: MailingSettings): Promise<void> {
    await this.write('UPDATE mailing_settings SET enabled=?,per_minute=?,per_day=? WHERE id=1', [settings.enabled, settings.perMinute, settings.perDay]);
  }
  async sentToday(now: Date): Promise<number> {
    return Number((await this.rows("SELECT COUNT(*) total FROM mailing_deliveries WHERE status='sent' AND sent_at>=?", [dayStart(now)]))[0]!.total);
  }
  async listCampaigns(): Promise<MailingCampaignSummary[]> {
    const summary = CAMPAIGN_SELECT.replace('c.*', 'c.id,c.title,c.revision,c.status,c.channels_json,c.created_by_id,c.created_by_name,c.created_at,c.updated_at,c.scheduled_at,c.started_at,c.finished_at');
    return (await this.rows(`${summary} ORDER BY c.created_at DESC,c.id LIMIT 100`)).map(campaignSummary);
  }
  async getCampaign(id: string): Promise<MailingCampaign | null> {
    const rows = await this.rows(`${CAMPAIGN_SELECT} WHERE c.id=?`, [id]); return rows.length ? campaign(rows[0]!) : null;
  }
  async createDraft(input: MailingDraftInput, actor: MailingActor, now: Date): Promise<MailingCampaign> {
    const id = randomUUID();
    await this.write(`INSERT INTO mailing_campaigns (id,title,content_json,channels_json,audience_json,created_by_id,created_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, input.title || `Рассылка ${now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}`, JSON.stringify(input.content), JSON.stringify(input.channels), JSON.stringify(input.audience), actor.id, actor.displayName, now, now]);
    return (await this.getCampaign(id))!;
  }
  async updateDraft(id: string, revision: number, input: MailingDraftInput, now: Date): Promise<MailingCampaign> {
    const changed = await this.write(`UPDATE mailing_campaigns SET title=?,content_json=?,channels_json=?,audience_json=?,revision=revision+1,updated_at=? WHERE id=? AND status='draft' AND revision=?`,
      [input.title || 'Рассылка', JSON.stringify(input.content), JSON.stringify(input.channels), JSON.stringify(input.audience), now, id, revision]);
    if (!changed) conflict();
    return (await this.getCampaign(id))!;
  }
  async deleteDraft(id: string): Promise<void> {
    if (!await this.write("DELETE FROM mailing_campaigns WHERE id=? AND status='draft'", [id])) conflict('Удалить можно только существующий черновик');
  }
  async enqueue(id: string, revision: number, recipients: PlannedRecipient[], scheduledAt: Date | null, now: Date): Promise<MailingCampaign> {
    await this.transaction(async connection => {
      const rows = await this.rows('SELECT * FROM mailing_campaigns WHERE id=? FOR UPDATE', [id], connection);
      const row = rows[0];
      if (!row) throw new MailingError('not_found', 'Рассылка не найдена', 404);
      if (row.status !== 'draft') {
        if (Number(row.launch_revision) === revision && nullableIso(row.scheduled_at) === (scheduledAt?.toISOString() ?? null)) return;
        conflict('Рассылка уже запущена. Обновите историю');
      }
      if (Number(row.revision) !== revision) conflict();
      const deliveries = recipients.flatMap(recipient => recipient.channels.map(channel => [
        randomUUID(), id, recipient.key, recipient.userId ? 'user' : 'contact', recipient.userId, recipient.contactId, recipient.email,
        recipient.name.slice(0, 160), recipient.company.slice(0, 200), channel, randomBytes(32).toString('hex'),
      ]));
      for (let offset = 0; offset < deliveries.length; offset += 100) {
        const chunk = deliveries.slice(offset, offset + 100);
        await this.write(`INSERT INTO mailing_deliveries (id,campaign_id,recipient_key,recipient_kind,user_id,contact_id,email,name,company,channel,public_token) VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',')}`, chunk.flat(), connection);
      }
      await this.write("UPDATE mailing_campaigns SET status=?,scheduled_at=?,started_at=?,launch_revision=?,revision=revision+1,updated_at=? WHERE id=?", [scheduledAt ? 'scheduled' : 'sending', scheduledAt, scheduledAt ? null : now, revision, now, id], connection);
    });
    return (await this.getCampaign(id))!;
  }
  async deliveries(id: string, page: number): Promise<MailingPage<MailingDelivery>> {
    const rows = await this.rows('SELECT * FROM mailing_deliveries WHERE campaign_id=? ORDER BY id LIMIT ? OFFSET ?', [id, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const count = await this.rows('SELECT COUNT(*) total FROM mailing_deliveries WHERE campaign_id=?', [id]);
    return { items: rows.map(delivery), total: Number(count[0]!.total), page, pageSize: PAGE_SIZE };
  }
  async cancel(id: string, now: Date): Promise<void> {
    await this.transaction(async connection => {
      const changed = await this.write("UPDATE mailing_campaigns SET status='cancelled',finished_at=?,updated_at=? WHERE id=? AND status IN ('scheduled','sending')", [now, now, id], connection);
      if (!changed) conflict('Отменить можно только запланированную или текущую рассылку');
      await this.write("UPDATE mailing_deliveries SET status='cancelled',error='Отменено администратором' WHERE campaign_id=? AND status='queued'", [id], connection);
    });
  }
  async retry(id: string, now: Date): Promise<void> {
    await this.transaction(async connection => {
      const rows = await this.rows('SELECT status FROM mailing_campaigns WHERE id=? FOR UPDATE', [id], connection);
      if (!rows.length) throw new MailingError('not_found', 'Рассылка не найдена', 404);
      if (!['done', 'cancelled'].includes(str(rows[0]!.status))) conflict('Дождитесь завершения рассылки перед повтором');
      const changed = await this.write("UPDATE mailing_deliveries SET status='queued',error=NULL,lease_token=NULL,locked_at=NULL WHERE campaign_id=? AND status='failed'", [id], connection);
      if (!changed) conflict('В этой рассылке нет ошибок для повтора');
      await this.write("UPDATE mailing_campaigns SET status='sending',scheduled_at=NULL,finished_at=NULL,updated_at=? WHERE id=?", [now, id], connection);
    });
  }
  async claim(now: Date): Promise<MailingJob | null> {
    return this.transaction(async connection => {
      // The single settings row serializes rate reservations across server instances.
      const settings = (await this.rows('SELECT * FROM mailing_settings WHERE id=1 FOR UPDATE', [], connection))[0];
      if (!settings?.enabled) return null;
      const minuteStart = new Date(now.getTime() - 60_000); const today = dayStart(now);
      const windowStart = new Date(Math.min(minuteStart.getTime(), today.getTime()));
      const count = (await this.rows(`SELECT SUM(attempted_at>=?) minute_count,SUM(attempted_at>=?) day_count FROM mailing_attempts WHERE attempted_at>=?`, [minuteStart, today, windowStart], connection))[0]!;
      if (Number(count.minute_count ?? 0) >= Number(settings.per_minute) || Number(count.day_count) >= Number(settings.per_day)) return null;
      const rows = await this.rows(`SELECT d.*,c.content_json FROM mailing_deliveries d JOIN mailing_campaigns c ON c.id=d.campaign_id
        WHERE d.status='queued' AND c.status IN ('sending','scheduled') AND (c.scheduled_at IS NULL OR c.scheduled_at<=?)
        ORDER BY c.created_at,d.id LIMIT 1 FOR UPDATE`, [now], connection);
      if (!rows.length) return null;
      const row = rows[0]!; const lease = randomUUID();
      const content = json<MailingJob['content']>(row.content_json);
      await this.write("UPDATE mailing_deliveries SET status='sending',lease_token=?,locked_at=?,attempted_at=?,attempts=attempts+1 WHERE id=? AND status='queued'", [lease, now, now, str(row.id)], connection);
      await this.write('INSERT INTO mailing_attempts (delivery_id,lease_token,attempted_at) VALUES (?,?,?)', [str(row.id), lease, now], connection);
      await this.write("UPDATE mailing_campaigns SET status='sending',started_at=COALESCE(started_at,?) WHERE id=? AND status='scheduled'", [now, str(row.campaign_id)], connection);
      return { ...delivery(row), status: 'sending', attempts: Number(row.attempts) + 1, token: str(row.public_token), lease, recipientKind: row.recipient_kind as MailingJob['recipientKind'], content };
    });
  }
  async recipientAvailable(job: MailingJob): Promise<boolean> {
    if (job.recipientKind === 'user') {
      if (!job.userId) return false;
      const rows = await this.rows('SELECT email FROM users WHERE id=? AND deleted_at IS NULL', [job.userId]);
      return rows.length > 0 && (job.channel !== 'email' || normalizeMailingEmail(str(rows[0]!.email)) === job.email);
    }
    if (!job.contactId) return false;
    return (await this.rows("SELECT id FROM mailing_contacts WHERE id=? AND status='active'", [job.contactId])).length > 0;
  }
  async finish(job: MailingJob, status: 'sent' | 'failed' | 'skipped', error: string | null, now: Date): Promise<void> {
    await this.transaction(async connection => {
      const changed = await this.write("UPDATE mailing_deliveries SET status=?,error=?,sent_at=?,lease_token=NULL,locked_at=NULL WHERE id=? AND status='sending' AND lease_token=?", [status, error, status === 'sent' ? now : null, job.id, job.lease], connection);
      if (changed) await this.write("UPDATE mailing_attempts SET status=?,finished_at=? WHERE lease_token=? AND status='sending'", [status, now, job.lease], connection);
    });
  }
  async reconcile(now: Date): Promise<void> {
    await this.write("UPDATE mailing_attempts SET status='unknown',finished_at=? WHERE status='sending' AND attempted_at<?", [now, new Date(now.getTime() - 120_000)]);
    await this.write("UPDATE mailing_deliveries SET status='failed',error='Отправка прервана. Проверьте результат перед повтором',lease_token=NULL,locked_at=NULL WHERE status='sending' AND locked_at<?", [new Date(now.getTime() - 120_000)]);
    await this.write(`UPDATE mailing_campaigns c SET status='done',finished_at=?,updated_at=? WHERE c.status IN ('sending','scheduled')
      AND NOT EXISTS(SELECT 1 FROM mailing_deliveries d WHERE d.campaign_id=c.id AND d.status IN ('queued','sending'))`, [now, now]);
  }
  async unsubscribe(token: string): Promise<boolean> {
    return this.transaction(async connection => {
      const rows = await this.rows('SELECT email FROM mailing_deliveries WHERE public_token=?', [token], connection);
      const email = rows[0]?.email ? str(rows[0]!.email) : null;
      if (!email) return false;
      await this.write("INSERT INTO mailing_suppressions (email,reason) VALUES (?,'unsubscribed') ON DUPLICATE KEY UPDATE reason='unsubscribed'", [email], connection);
      await this.write("UPDATE mailing_contacts SET status='unsubscribed' WHERE email=? AND status='active'", [email], connection);
      return true;
    });
  }
  async click(token: string, now: Date): Promise<string | null> {
    return this.transaction(async connection => {
      const rows = await this.rows('SELECT d.id,c.content_json FROM mailing_deliveries d JOIN mailing_campaigns c ON c.id=d.campaign_id WHERE d.public_token=?', [token], connection);
      if (!rows.length) return null;
      const url = json<MailingDraftInput['content']>(rows[0]!.content_json).buttonUrl;
      if (!url) return null;
      await this.write('UPDATE mailing_deliveries SET clicked_at=COALESCE(clicked_at,?) WHERE id=?', [now, str(rows[0]!.id)], connection);
      return url;
    });
  }
}
