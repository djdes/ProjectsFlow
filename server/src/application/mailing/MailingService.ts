import { createHash } from 'node:crypto';
import type { EmailSender } from '../notifications/EmailSender.js';
import type { MailingRepository, MailingTemplateInput, MailingWorkspaceOption } from './MailingRepository.js';
import type {
  MailingAudience,
  MailingCampaign,
  MailingCandidate,
  MailingContent,
  MailingRecipientFailure,
  MailingTemplate,
} from '../../domain/mailing/Mailing.js';
import { MAILING_LIMITS } from '../../domain/mailing/Mailing.js';
import { isMailingLayout, parseMailingOffer } from '../../domain/mailing/layouts.js';
import { MailingError } from '../../domain/mailing/errors.js';
import { selectMailingRecipients, type MailingReach } from '../../domain/mailing/audience.js';
import { MAILING_STARTERS, type MailingStarter } from '../../domain/mailing/starters.js';
import type { MailingVariables } from '../../domain/mailing/renderMailingBody.js';
import { renderMailingEmail, renderMailingPreheader } from './mailingEmail.js';
import { createUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribeToken.js';

export type MailingPreview = {
  readonly subject: string;
  readonly preheader: string;
  readonly html: string;
  readonly text: string;
};

export type UnsubscribePreview =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly maskedEmail: string; readonly alreadyUnsubscribed: boolean };

export type UnsubscribeResult = { readonly kind: 'invalid' } | { readonly kind: 'done'; readonly maskedEmail: string };

type Deps = {
  readonly repo: MailingRepository;
  readonly email: EmailSender;
  readonly appUrl: string;
  readonly tokenSecret: string;
  readonly idGen: () => string;
  readonly now: () => Date;
  // Called after a launch so the queue starts without waiting for the next tick.
  readonly wakeQueue?: () => void;
};

const TEST_MIN_INTERVAL_MS = 5_000;
const TEST_HOURLY_LIMIT = 30;

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${visible}${'*'.repeat(Math.max(1, Math.min(5, local.length - visible.length)))}@${domain}`;
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Normalizes and validates editor input; throws invalid_content with a readable reason. */
export function parseMailingContent(raw: unknown): MailingContent {
  const v = (raw ?? {}) as Record<string, unknown>;
  const subject = clean(v['subject'], MAILING_LIMITS.subject);
  const bodyMarkdown = typeof v['bodyMarkdown'] === 'string' ? v['bodyMarkdown'].slice(0, MAILING_LIMITS.body) : '';
  const ctaLabel = clean(v['ctaLabel'], MAILING_LIMITS.ctaLabel) || null;
  const ctaUrl = clean(v['ctaUrl'], MAILING_LIMITS.ctaUrl) || null;
  if (!subject) throw new MailingError('invalid_content', 'Укажите тему письма');
  if (!bodyMarkdown.trim()) throw new MailingError('invalid_content', 'Текст письма пустой');
  if (ctaUrl && !/^https?:\/\/\S+$/i.test(ctaUrl)) {
    throw new MailingError('invalid_content', 'Ссылка кнопки должна начинаться с https://');
  }
  if (ctaUrl && !ctaLabel) throw new MailingError('invalid_content', 'Укажите текст кнопки');
  const rawLayout = v['layout'] ?? 'standard';
  if (!isMailingLayout(rawLayout)) throw new MailingError('invalid_content', 'Неизвестный макет письма');
  // The classic letter has no offer strip; stale promo terms are dropped with the layout.
  const offer = rawLayout === 'standard' ? null : parseMailingOffer(v['offer']);
  return {
    subject, preheader: clean(v['preheader'], MAILING_LIMITS.preheader), bodyMarkdown, ctaLabel, ctaUrl: ctaLabel ? ctaUrl : null,
    layout: rawLayout, offer,
  };
}

export function parseMailingTemplateInput(raw: unknown): MailingTemplateInput {
  const name = clean((raw as Record<string, unknown> | null)?.['name'], MAILING_LIMITS.name);
  if (!name) throw new MailingError('invalid_content', 'Укажите название шаблона');
  return { name, ...parseMailingContent(raw) };
}

export function mailingRequestHash(templateId: string, audience: MailingAudience, content: MailingContent): string {
  return createHash('sha256').update(JSON.stringify({ templateId, audience, content })).digest('hex');
}

function contentOf(t: MailingTemplate): MailingContent {
  return {
    subject: t.subject, preheader: t.preheader, bodyMarkdown: t.bodyMarkdown, ctaLabel: t.ctaLabel, ctaUrl: t.ctaUrl,
    layout: t.layout, offer: t.offer,
  };
}

export class MailingService {
  private readonly testSends = new Map<string, number[]>();

  constructor(private readonly deps: Deps) {}

  unsubscribeUrl(userId: string): string {
    return `${this.deps.appUrl.replace(/\/+$/, '')}/api/mailing/unsubscribe/${createUnsubscribeToken(userId, this.deps.tokenSecret)}`;
  }

  varsOf(recipient: Pick<MailingCandidate, 'displayName' | 'workspaceName'>): MailingVariables {
    return { name: recipient.displayName, workspace: recipient.workspaceName ?? '' };
  }

  // --- templates ---

  listTemplates(): Promise<MailingTemplate[]> {
    return this.deps.repo.listTemplates();
  }

  starters(): readonly MailingStarter[] {
    return MAILING_STARTERS;
  }

  createTemplate(raw: unknown, adminId: string): Promise<MailingTemplate> {
    return this.deps.repo.createTemplate(this.deps.idGen(), parseMailingTemplateInput(raw), adminId);
  }

  async updateTemplate(id: string, raw: unknown): Promise<MailingTemplate> {
    const updated = await this.deps.repo.updateTemplate(id, parseMailingTemplateInput(raw));
    if (!updated) throw new MailingError('template_not_found', 'Шаблон не найден');
    return updated;
  }

  async deleteTemplate(id: string): Promise<void> {
    if (!(await this.deps.repo.deleteTemplate(id))) throw new MailingError('template_not_found', 'Шаблон не найден');
  }

  // --- preview and test ---

  /** Renders exactly what the admin would receive; unsaved editor content is allowed. */
  async preview(raw: unknown, admin: { id: string; email: string; displayName: string }): Promise<MailingPreview> {
    const content = parseMailingContent(raw);
    const recipient = (await this.deps.repo.findRecipient(admin.id)) ?? { ...admin, userId: admin.id, workspaceName: null };
    const vars = this.varsOf(recipient);
    const msg = renderMailingEmail({
      to: recipient.email, content, vars, unsubscribeUrl: this.unsubscribeUrl(admin.id), assetBaseUrl: this.deps.appUrl,
    });
    return { subject: msg.subject, preheader: renderMailingPreheader(content, vars), html: msg.html, text: msg.text };
  }

  /** Sends the letter to the admin's own address only; never to other users. */
  async sendTest(raw: unknown, admin: { id: string; email: string; displayName: string }): Promise<{ to: string }> {
    const content = parseMailingContent(raw);
    const now = this.deps.now().getTime();
    const recent = (this.testSends.get(admin.id) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= TEST_HOURLY_LIMIT || (recent.length > 0 && now - recent[recent.length - 1]! < TEST_MIN_INTERVAL_MS)) {
      throw new MailingError('test_rate_limited', 'Слишком часто: подождите немного перед следующим тестом');
    }
    this.testSends.set(admin.id, [...recent, now]);
    const recipient = (await this.deps.repo.findRecipient(admin.id)) ?? { ...admin, userId: admin.id, workspaceName: null };
    await this.deps.email.send(renderMailingEmail({
      to: admin.email, content, vars: this.varsOf(recipient), unsubscribeUrl: this.unsubscribeUrl(admin.id), assetBaseUrl: this.deps.appUrl, test: true,
    }));
    return { to: admin.email };
  }

  // --- audience ---

  listWorkspaceOptions(): Promise<MailingWorkspaceOption[]> {
    return this.deps.repo.listWorkspaceOptions();
  }

  async reach(audience: MailingAudience): Promise<MailingReach> {
    return (await this.select(audience)).reach;
  }

  private async select(audience: MailingAudience): Promise<ReturnType<typeof selectMailingRecipients>> {
    if (audience.kind === 'workspace' && !(await this.deps.repo.workspaceExists(audience.workspaceId))) {
      throw new MailingError('workspace_not_found', 'Пространство не найдено');
    }
    const [candidates, unsubscribed] = await Promise.all([
      this.deps.repo.listAudienceCandidates(audience, this.deps.now()),
      this.deps.repo.listUnsubscribedUserIds(),
    ]);
    return selectMailingRecipients(candidates, unsubscribed);
  }

  // --- campaigns ---

  /**
   * Launches a campaign from a template snapshot. `requestId` becomes the campaign id, so a
   * retried request returns the same campaign; `expectedReach` must match the reach the
   * admin confirmed, otherwise the audience changed since and the admin must look again.
   */
  async launch(input: { requestId: string; templateId: string; audience: MailingAudience; expectedReach: number }, adminId: string): Promise<MailingCampaign> {
    const template = await this.deps.repo.getTemplate(input.templateId);
    if (!template) throw new MailingError('template_not_found', 'Шаблон не найден');
    const content = parseMailingContent(contentOf(template));
    const requestHash = mailingRequestHash(template.id, input.audience, content);

    const existingHash = await this.deps.repo.getCampaignRequestHash(input.requestId);
    if (existingHash !== null) {
      if (existingHash !== requestHash) throw new MailingError('request_conflict', 'Этот запуск уже выполнен с другими параметрами');
      const existing = await this.deps.repo.getCampaign(input.requestId);
      if (existing) return existing;
    }

    const { recipients, reach } = await this.select(input.audience);
    if (reach.eligible === 0) throw new MailingError('audience_empty', 'В аудитории нет ни одного получателя');
    if (reach.eligible !== input.expectedReach) {
      throw new MailingError('audience_changed', `Аудитория изменилась: теперь получателей ${reach.eligible}. Проверьте охват и запустите снова`);
    }
    const result = await this.deps.repo.createCampaign({
      id: input.requestId, templateId: template.id, name: template.name, content, audience: input.audience,
      requestHash, createdBy: adminId, recipients,
    }, this.deps.now());
    if (result.kind === 'exists' && result.requestHash !== requestHash) {
      throw new MailingError('request_conflict', 'Этот запуск уже выполнен с другими параметрами');
    }
    this.deps.wakeQueue?.();
    return result.campaign;
  }

  listCampaigns(): Promise<MailingCampaign[]> {
    return this.deps.repo.listCampaigns(50);
  }

  async getCampaign(id: string): Promise<{ campaign: MailingCampaign; problems: MailingRecipientFailure[] }> {
    const campaign = await this.deps.repo.getCampaign(id);
    if (!campaign) throw new MailingError('campaign_not_found', 'Рассылка не найдена');
    return { campaign, problems: await this.deps.repo.listRecipientProblems(id, 50) };
  }

  async cancel(id: string): Promise<MailingCampaign> {
    const campaign = await this.deps.repo.getCampaign(id);
    if (!campaign) throw new MailingError('campaign_not_found', 'Рассылка не найдена');
    if (!(await this.deps.repo.cancelCampaign(id, this.deps.now()))) {
      throw new MailingError('not_cancellable', 'Рассылка уже завершена');
    }
    return (await this.deps.repo.getCampaign(id)) ?? campaign;
  }

  // --- public unsubscribe ---

  async previewUnsubscribe(token: string): Promise<UnsubscribePreview> {
    const userId = verifyUnsubscribeToken(token, this.deps.tokenSecret);
    const recipient = userId ? await this.deps.repo.findRecipient(userId) : null;
    if (!userId || !recipient) return { kind: 'invalid' };
    return { kind: 'ok', maskedEmail: maskEmail(recipient.email), alreadyUnsubscribed: await this.deps.repo.isUnsubscribed(userId) };
  }

  async unsubscribe(token: string): Promise<UnsubscribeResult> {
    const userId = verifyUnsubscribeToken(token, this.deps.tokenSecret);
    const recipient = userId ? await this.deps.repo.findRecipient(userId) : null;
    if (!userId || !recipient) return { kind: 'invalid' };
    await this.deps.repo.unsubscribe(userId, this.deps.now());
    return { kind: 'done', maskedEmail: maskEmail(recipient.email) };
  }
}
