import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Megaphone, Rocket, Send, Square, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/relativeTime';
import { useContainer } from '@/infrastructure/di/container';
import type {
  MailingAudience,
  MailingCampaign,
  MailingPlan,
  MailingReach,
  MailingRecipientProblem,
  MailingTemplate,
  MailingWorkspaceOption,
} from '@/domain/mailing/Mailing';
import { MailingPreview } from './MailingPreview';
import { mailingErrorText } from './MailingTemplatesView';
import { CAMPAIGN_STATUS, PLAN_LABEL, audienceSummary, campaignProgress, contentOf, pluralRu } from './mailingFormat';

type AudienceKind = MailingAudience['kind'];

const AUDIENCE_KINDS = [
  { value: 'all', label: 'Все' },
  { value: 'workspace', label: 'Пространство' },
  { value: 'plan', label: 'Тариф' },
] as const;

const PLANS: readonly MailingPlan[] = ['free', 'prime', 'vip'];
const SELECT_CLASS = 'h-11 w-full min-w-0 rounded-md border bg-background px-2 text-sm sm:h-8';
const POLL_MS = 4_000;

const newRequestId = (): string => crypto.randomUUID();

// Campaigns: compose from a saved template (audience, reach, test, launch) and follow
// delivery progress of earlier sends. Progress is polled while something is sending.
export function MailingCampaignsView({ preselectTemplateId }: { preselectTemplateId: string | null }): React.ReactElement {
  const { mailingRepository } = useContainer();
  const [campaigns, setCampaigns] = useState<MailingCampaign[] | null>(null);
  const [templates, setTemplates] = useState<MailingTemplate[]>([]);
  const [workspaces, setWorkspaces] = useState<MailingWorkspaceOption[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    setCampaigns(await mailingRepository.listCampaigns());
  }, [mailingRepository]);

  useEffect(() => {
    Promise.all([mailingRepository.listCampaigns(), mailingRepository.listTemplates(), mailingRepository.listWorkspaces()])
      .then(([c, t, w]) => { setCampaigns(c); setTemplates(t.templates); setWorkspaces(w); })
      .catch((e: unknown) => toast.error(mailingErrorText(e, 'Не удалось загрузить рассылки')));
  }, [mailingRepository]);

  const sending = campaigns?.some((c) => c.status === 'sending') ?? false;
  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(() => { void reload().catch(() => {}); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [sending, reload]);

  if (!campaigns) {
    return (
      <LoadingRegion className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
      </LoadingRegion>
    );
  }

  return (
    <div className="space-y-6">
      <Composer
        templates={templates}
        workspaces={workspaces}
        preselectTemplateId={preselectTemplateId}
        onLaunched={(c) => setCampaigns((list) => [c, ...(list ?? []).filter((x) => x.id !== c.id)])}
      />
      <section aria-label="История рассылок" className="space-y-2">
        <h3 className="text-ui font-medium text-muted-foreground">История ({campaigns.length})</h3>
        {campaigns.length === 0 ? (
          <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-card">Рассылок ещё не было</p>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <CampaignRow key={c.id} campaign={c} workspaces={workspaces}
                onChange={(next) => setCampaigns((list) => (list ?? []).map((x) => (x.id === next.id ? next : x)))} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Composer({
  templates,
  workspaces,
  preselectTemplateId,
  onLaunched,
}: {
  templates: readonly MailingTemplate[];
  workspaces: readonly MailingWorkspaceOption[];
  preselectTemplateId: string | null;
  onLaunched: (c: MailingCampaign) => void;
}): React.ReactElement {
  const { mailingRepository } = useContainer();
  const [templateId, setTemplateId] = useState<string>(preselectTemplateId ?? '');
  const [kind, setKind] = useState<AudienceKind>('all');
  const [workspaceId, setWorkspaceId] = useState('');
  const [plans, setPlans] = useState<MailingPlan[]>(['prime', 'vip']);
  const [reach, setReach] = useState<MailingReach | null>(null);
  const [reachError, setReachError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'launch' | null>(null);
  const [confirming, setConfirming] = useState(false);
  // One id per launch intent: a retry after a network error reuses it, so the server
  // returns the same campaign instead of sending twice.
  const requestId = useRef(newRequestId());

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(preselectTemplateId ?? templates[0].id);
  }, [templates, templateId, preselectTemplateId]);
  useEffect(() => { if (preselectTemplateId) setTemplateId(preselectTemplateId); }, [preselectTemplateId]);

  const audience = useMemo((): MailingAudience | null => {
    if (kind === 'all') return { kind: 'all' };
    if (kind === 'workspace') return workspaceId ? { kind: 'workspace', workspaceId } : null;
    return plans.length > 0 ? { kind: 'plan', plans: PLANS.filter((p) => plans.includes(p)) } : null;
  }, [kind, workspaceId, plans]);
  const audienceKey = JSON.stringify(audience);

  useEffect(() => {
    requestId.current = newRequestId();
    setReach(null);
    setReachError(null);
    if (!audience) return;
    let cancelled = false;
    mailingRepository.reach(audience)
      .then((r) => { if (!cancelled) setReach(r); })
      .catch((e: unknown) => { if (!cancelled) setReachError(mailingErrorText(e, 'Не удалось посчитать охват')); });
    return () => { cancelled = true; };
    // audienceKey stands for audience: the memoized object is recreated on equal values.
  }, [audienceKey, mailingRepository]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { requestId.current = newRequestId(); }, [templateId]);

  const template = templates.find((t) => t.id === templateId) ?? null;

  const sendTest = async (): Promise<void> => {
    if (!template || busy) return;
    setBusy('test');
    try {
      const { to } = await mailingRepository.sendTest(contentOf(template));
      toast.success(`Тестовое письмо отправлено на ${to}`);
    } catch (e) {
      toast.error(mailingErrorText(e, 'Не удалось отправить тест'));
    } finally {
      setBusy(null);
    }
  };

  const launch = async (): Promise<void> => {
    if (!template || !audience || !reach || busy) return;
    setBusy('launch');
    try {
      const campaign = await mailingRepository.launch({
        requestId: requestId.current, templateId: template.id, audience, expectedReach: reach.eligible,
      });
      requestId.current = newRequestId();
      setConfirming(false);
      onLaunched(campaign);
      toast.success(`Рассылка запущена: ${campaign.totalCount} ${pluralRu(campaign.totalCount, 'письмо', 'письма', 'писем')}`);
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      toast.error(mailingErrorText(e, 'Не удалось запустить рассылку'));
      // The audience changed or the request clashed: a fresh look is needed, not a resend.
      if (status === 409) {
        setConfirming(false);
        requestId.current = newRequestId();
        if (audience) mailingRepository.reach(audience).then(setReach).catch(() => {});
      }
    } finally {
      setBusy(null);
    }
  };

  if (templates.length === 0) {
    return (
      <section className="rounded-lg bg-card p-4 text-sm text-muted-foreground shadow-card">
        <h3 className="mbe-1 flex items-center gap-2 font-medium text-foreground"><Megaphone className="size-4" /> Новая рассылка</h3>
        Сначала сохраните шаблон письма на вкладке «Шаблоны» — рассылка отправляется из шаблона.
      </section>
    );
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <section className="min-w-0 space-y-4 rounded-lg bg-card p-3 shadow-card sm:p-4" aria-label="Новая рассылка">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Megaphone className="size-4 text-muted-foreground" /> Новая рассылка</h3>
        <div className="space-y-1.5">
          <Label htmlFor="mailing-template">Шаблон</Label>
          <select id="mailing-template" className={SELECT_CLASS} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <span className="text-sm font-medium">Кому</span>
          <SegmentedControl className="flex w-full [&>*]:flex-1" value={kind} onChange={setKind} options={AUDIENCE_KINDS} />
          {kind === 'workspace' && (
            <select aria-label="Пространство" className={SELECT_CLASS} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              <option value="">Выберите пространство</option>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.memberCount} {pluralRu(w.memberCount, 'участник', 'участника', 'участников')}</option>)}
            </select>
          )}
          {kind === 'plan' && (
            <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Тарифы">
              {PLANS.map((p) => (
                <label key={p} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                  <Checkbox checked={plans.includes(p)}
                    onCheckedChange={(on) => setPlans((list) => (on === true ? [...list, p] : list.filter((x) => x !== p)))} />
                  {PLAN_LABEL[p]}
                </label>
              ))}
            </div>
          )}
        </div>
        <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm" data-pf-mailing-reach aria-live="polite">
          <Users className="mbs-0.5 size-4 shrink-0 text-muted-foreground" />
          {reachError ? <span className="text-destructive">{reachError}</span>
            : !audience ? <span className="text-muted-foreground">Выберите аудиторию</span>
            : !reach ? <span className="text-muted-foreground">Считаем охват…</span>
            : (
              <span>
                Получат письмо: <strong>{reach.eligible}</strong>
                {(reach.unsubscribed > 0 || reach.invalid > 0) && (
                  <span className="text-muted-foreground">
                    {reach.unsubscribed > 0 && ` · отписались: ${reach.unsubscribed}`}
                    {reach.invalid > 0 && ` · без адреса или повтор: ${reach.invalid}`}
                  </span>
                )}
              </span>
            )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void sendTest()} disabled={!template || busy !== null}>
            {busy === 'test' ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Send className="size-4" />}
            Отправить тест себе
          </Button>
          <Button onClick={() => setConfirming(true)} disabled={!template || !reach || reach.eligible === 0 || busy !== null}>
            <Rocket className="size-4" /> Запустить
          </Button>
        </div>
      </section>
      {template && <MailingPreview content={template} />}

      {confirming && template && reach && audience && (
        <Dialog open onOpenChange={(o) => !o && busy !== 'launch' && setConfirming(false)}>
          <DialogContent hideClose={busy === 'launch'}>
            <DialogHeader>
              <DialogTitle>Запустить рассылку?</DialogTitle>
              <DialogDescription>
                «{template.name}» уйдёт {reach.eligible} {pluralRu(reach.eligible, 'получателю', 'получателям', 'получателям')} ({audienceSummary(audience, workspaces).toLowerCase()}).
                Письма отправляются постепенно; остановить можно в истории.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy === 'launch'}>Отмена</Button>
              <Button onClick={() => void launch()} disabled={busy === 'launch'}>
                {busy === 'launch' ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Rocket className="size-4" />}
                Отправить {reach.eligible} {pluralRu(reach.eligible, 'письмо', 'письма', 'писем')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CampaignRow({
  campaign: c,
  workspaces,
  onChange,
}: {
  campaign: MailingCampaign;
  workspaces: readonly MailingWorkspaceOption[];
  onChange: (c: MailingCampaign) => void;
}): React.ReactElement {
  const { mailingRepository } = useContainer();
  const [open, setOpen] = useState(false);
  const [problems, setProblems] = useState<MailingRecipientProblem[] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const progress = campaignProgress(c);
  const status = CAMPAIGN_STATUS[c.status];
  const problemCount = c.counts.failed + c.counts.skipped;

  useEffect(() => {
    if (!open) return;
    mailingRepository.getCampaign(c.id)
      .then((r) => setProblems(r.problems))
      .catch((e: unknown) => toast.error(mailingErrorText(e, 'Не удалось загрузить подробности')));
  }, [open, c.id, problemCount, mailingRepository]);

  const cancel = async (): Promise<void> => {
    if (!window.confirm('Остановить рассылку? Неотправленные письма не уйдут.')) return;
    setCancelling(true);
    try {
      onChange(await mailingRepository.cancel(c.id));
      toast.success('Рассылка остановлена');
    } catch (e) {
      toast.error(mailingErrorText(e, 'Не удалось остановить рассылку'));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <li className="space-y-2 rounded-lg bg-card p-3 shadow-card sm:p-4" data-pf-mailing-campaign={c.id}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{c.name}</span>
            <span className={cn('shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-medium', status.className)}>{status.label}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {audienceSummary(c.audience, workspaces)} · {relativeTime(new Date(c.createdAt))}
          </p>
        </div>
        {c.status === 'sending' && (
          <Button size="sm" variant="outline" onClick={() => void cancel()} disabled={cancelling}>
            {cancelling ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : <Square className="size-3.5" />}
            Остановить
          </Button>
        )}
      </div>
      <Progress value={progress.percent} aria-label="Прогресс рассылки" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Отправлено <strong className="text-foreground">{c.counts.sent}</strong> из {progress.total}</span>
        {c.counts.queued + c.counts.sending > 0 && <span>в очереди {c.counts.queued + c.counts.sending}</span>}
        {c.counts.failed > 0 && <span className="text-destructive">ошибок {c.counts.failed}</span>}
        {c.counts.skipped > 0 && <span>пропущено {c.counts.skipped}</span>}
        {c.counts.cancelled > 0 && <span>отменено {c.counts.cancelled}</span>}
        {problemCount > 0 && (
          <button type="button" className="ms-auto inline-flex min-h-11 items-center gap-1 text-primary-ink hover:underline sm:min-h-0"
            aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            Подробнее <ChevronDown className={cn('size-3.5', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && (
        problems === null ? <Skeleton className="h-10 rounded-md" /> : (
          <ul className="divide-y divide-border rounded-md border text-xs">
            {problems.map((p) => (
              <li key={p.email} className="flex flex-wrap gap-x-2 px-3 py-2">
                <span className="min-w-0 truncate font-medium">{p.displayName}</span>
                <span className="min-w-0 truncate text-muted-foreground">{p.email}</span>
                <span className={cn('basis-full', p.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                  {p.status === 'failed' ? 'Ошибка' : 'Пропущено'}{p.error ? `: ${p.error}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </li>
  );
}
