import type {
  MailingAudience,
  MailingCampaign,
  MailingContent,
  MailingPlan,
  MailingTemplateDraft,
  MailingWorkspaceOption,
} from '@/domain/mailing/Mailing';

// Preview frame widths: the desktop letter card is 600px plus the grey margins around it;
// the phone frame is an iPhone-sized 375px viewport where the letter's media query applies.
export const PREVIEW_FRAME_WIDTH = { desktop: 680, phone: 375 } as const;
export type PreviewDevice = keyof typeof PREVIEW_FRAME_WIDTH;

/** Zoom that fits a frame of `frameWidth` into `available` pixels; never enlarges. */
export function previewZoom(available: number, frameWidth: number): number {
  if (!Number.isFinite(available) || available <= 0) return 1;
  return Math.min(1, Math.floor((available / frameWidth) * 1000) / 1000);
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const PLAN_LABEL: Record<MailingPlan, string> = { free: 'Free', prime: 'Прайм', vip: 'VIP' };

export function audienceSummary(audience: MailingAudience, workspaces: readonly MailingWorkspaceOption[]): string {
  switch (audience.kind) {
    case 'all':
      return 'Все пользователи';
    case 'workspace': {
      const ws = workspaces.find((w) => w.id === audience.workspaceId);
      return ws ? `Пространство «${ws.name}»` : 'Участники пространства';
    }
    case 'plan':
      return `Тариф: ${audience.plans.map((p) => PLAN_LABEL[p]).join(', ')}`;
  }
}

export type CampaignProgress = { readonly processed: number; readonly total: number; readonly percent: number };

/** Processed = everything the queue is done with, delivered or not. */
export function campaignProgress(c: Pick<MailingCampaign, 'counts' | 'totalCount'>): CampaignProgress {
  const { sent, failed, skipped, cancelled } = c.counts;
  const processed = sent + failed + skipped + cancelled;
  const total = Math.max(c.totalCount, processed);
  return { processed, total, percent: total === 0 ? 100 : Math.round((processed / total) * 100) };
}

export const CAMPAIGN_STATUS: Record<MailingCampaign['status'], { label: string; className: string }> = {
  sending: { label: 'Отправляется', className: 'bg-primary-soft text-primary-ink' },
  completed: { label: 'Отправлена', className: 'bg-done-soft text-done-ink' },
  cancelled: { label: 'Остановлена', className: 'bg-muted text-muted-foreground' },
};

export const EMPTY_DRAFT: MailingTemplateDraft = {
  name: '',
  subject: '',
  preheader: '',
  bodyMarkdown: '',
  ctaLabel: null,
  ctaUrl: null,
};

export function contentOf(d: MailingContent): MailingContent {
  return { subject: d.subject, preheader: d.preheader, bodyMarkdown: d.bodyMarkdown, ctaLabel: d.ctaLabel || null, ctaUrl: d.ctaUrl || null };
}

export function sameDraft(a: MailingTemplateDraft, b: MailingTemplateDraft): boolean {
  return a.name === b.name && a.subject === b.subject && a.preheader === b.preheader && a.bodyMarkdown === b.bodyMarkdown
    && (a.ctaLabel || null) === (b.ctaLabel || null) && (a.ctaUrl || null) === (b.ctaUrl || null);
}

/** Enough content for the server to render a preview (subject and body are required). */
export function canPreview(d: MailingContent): boolean {
  return d.subject.trim().length > 0 && d.bodyMarkdown.trim().length > 0;
}

export const MAILING_VARIABLE_HINTS: ReadonlyArray<{ token: string; label: string }> = [
  { token: '{{name}}', label: 'имя получателя' },
  { token: '{{workspace}}', label: 'его пространство' },
];
