import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, FlaskConical, Plus, Save, Send, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useAuth } from '@/presentation/auth/AuthProvider';
import type { MailingRepository } from '@/application/mailing/MailingRepository';
import type { MailingAudience, MailingDraftInput, MailingOverview, MailingReach } from '@/domain/mailing/Mailing';
import { MailingChannels, MailingComposeFields, MailingPreviewPane, QuickMailing, emptyMailingDraft } from './MailingComposer';
import { ConfirmMailingAction, MailingAudienceUsers, MailingContacts, MailingSettingsForm, MailingStoplist } from './MailingLists';
import { MailingCampaignDetails, MailingHistory } from './MailingHistory';
import { BusyIcon, CHANNEL_NAMES, errorText, LoadState, PANEL, useMailingResource } from './ui';

type Tab = 'quick' | 'history' | 'compose' | 'users' | 'contacts' | 'stoplist';
const TABS: { id: Tab; label: string; advanced?: boolean }[] = [
  { id: 'quick', label: 'Быстрая отправка' }, { id: 'history', label: 'История' },
  { id: 'compose', label: 'Конструктор', advanced: true }, { id: 'users', label: 'Пользователи', advanced: true },
  { id: 'contacts', label: 'Контакты', advanced: true }, { id: 'stoplist', label: 'Стоп-лист', advanced: true },
];
export function AdminMailingPanel(): React.ReactElement {
  const { user } = useAuth();
  return user?.isAdmin ? <MailingLoader key={user.id} /> : <p role="alert" className="text-sm text-destructive">Рассылки доступны только администраторам.</p>;
}
function MailingLoader() {
  const { mailingRepository } = useContainer();
  const loader = useCallback(() => mailingRepository.overview(), [mailingRepository]);
  const resource = useMailingResource(loader, true);
  if (!resource.data) return <LoadState {...resource} retry={resource.reload} />;
  return <div className="space-y-4">{resource.error && <LoadState loading={false} error={resource.error} retry={resource.reload} />}<MailingWorkspace repository={mailingRepository} overview={resource.data} refresh={resource.reload} /></div>;
}
function MailingWorkspace({ repository, overview, refresh }: { repository: MailingRepository; overview: MailingOverview; refresh: () => void }) {
  const [params, setParams] = useSearchParams(); const selectedId = params.get('mailingCampaign');
  const [tab, setTab] = useState<Tab>(selectedId ? 'history' : 'quick'); const [advanced, setAdvanced] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false);
  const [form, setForm] = useState<{ id?: string; revision?: number; input: MailingDraftInput }>(() => ({ input: emptyMailingDraft([overview.channels.email ? 'email' : 'site']) }));
  const [savedKey, setSavedKey] = useState(() => JSON.stringify(emptyMailingDraft([overview.channels.email ? 'email' : 'site'])));
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [reach, setReach] = useState<MailingReach | null>(null); const [reachError, setReachError] = useState<string | null>(null); const [reachVersion, setReachVersion] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [launchMode, setLaunchMode] = useState<'now' | 'schedule' | null>(null); const [schedule, setSchedule] = useState('');
  const [switchTo, setSwitchTo] = useState<string | 'new' | null>(null);
  const [testResults, setTestResults] = useState<{ channel: string; status: string; message: string }[] | null>(null);
  const isCompose = !selectedId && (tab === 'quick' || tab === 'compose');
  const reachKey = JSON.stringify({ audience: form.input.audience, channels: form.input.channels });
  const dirty = JSON.stringify(form.input) !== savedKey;
  const hasContent = Boolean(form.input.title || form.input.content.body || form.input.content.subject || form.input.audience.baseIds.length || form.input.audience.userIds.length || form.input.audience.contactIds.length);
  const update = (input: MailingDraftInput) => { setForm(before => ({ ...before, input })); setTestResults(null); };
  const choose = (value: Tab) => { setTab(value); if (!['quick', 'history'].includes(value)) setAdvanced(true); setParams(before => { const next = new URLSearchParams(before); next.delete('mailingCampaign'); return next; }, { replace: true }); };
  const openCampaign = (id: string) => { setTab('history'); setParams(before => { const next = new URLSearchParams(before); next.set('tab', 'mailings'); next.set('mailingCampaign', id); return next; }); };
  const activeCampaigns = overview.campaigns.some(campaign => campaign.status === 'sending' || campaign.status === 'scheduled');
  useEffect(() => { if (tab !== 'history' || !activeCampaigns) return; const timer = setInterval(refresh, 10_000); return () => clearInterval(timer); }, [tab, activeCampaigns, refresh]);
  useEffect(() => {
    if (!isCompose) return;
    let active = true; setReach(null); setReachError(null);
    const selection = JSON.parse(reachKey) as Pick<MailingDraftInput, 'audience' | 'channels'>;
    const timer = setTimeout(() => {
      void repository.reach({ ...emptyMailingDraft(), ...selection }).then(value => { if (active) setReach(value); }).catch(error => { if (active) setReachError(errorText(error)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [repository, reachKey, reachVersion, overview, isCompose]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { await action(); } catch (error) { toast.error(errorText(error)); } finally { lock.current = false; setBusy(false); }
  };
  const persist = async () => {
    const saved = await repository.save(form.input, form.id, form.revision);
    setForm({ id: saved.id, revision: saved.revision, input: { title: saved.title, content: saved.content, channels: saved.channels, audience: saved.audience } });
    setSavedKey(JSON.stringify({ title: saved.title, content: saved.content, channels: saved.channels, audience: saved.audience }));
    refresh(); return saved;
  };
  const loadDraft = async (id: string) => {
    const { campaign } = await repository.details(id);
    if (campaign.status !== 'draft') throw new Error('Эта рассылка уже запущена. Откройте её историю');
    const input = { title: campaign.title, content: campaign.content, channels: campaign.channels, audience: campaign.audience };
    setForm({ id, revision: campaign.revision, input }); setSavedKey(JSON.stringify(input)); setTestResults(null); choose('compose');
  };
  const newDraft = () => { const input = emptyMailingDraft([overview.channels.email ? 'email' : 'site']); setForm({ input }); setSavedKey(JSON.stringify(input)); setTestResults(null); choose('quick'); };
  const requestEdit = (id: string) => { if (dirty && hasContent) setSwitchTo(id); else void run(() => loadDraft(id)); };
  const selection = (audience: MailingAudience) => update({ ...form.input, audience });
  useEffect(() => {
    if (launchMode !== 'schedule') return;
    setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [launchMode]);
  const validSchedule = schedule && Number.isFinite(Date.parse(`${schedule}+03:00`)) && Date.parse(`${schedule}+03:00`) >= clock + 60_000;
  const canSend = Boolean(reach?.deliveries && form.input.content.subject.trim() && form.input.content.body.trim() && form.input.channels.length && !busy);
  return <section className="min-w-0 space-y-5" aria-label="Рассылки ProjectsFlow">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-medium">Рассылки</h2><p className="mbs-1 text-sm text-muted-foreground">Выберите получателей и письмо, проверьте результат и запустите отправку.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => dirty && hasContent ? setSwitchTo('new') : newDraft()} disabled={busy}><Plus className="size-4" />Новая рассылка</Button><Button variant="ghost" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><Settings2 className="size-4" />Настройки</Button></div></div>
    {!overview.settings.enabled && <p role="status" className="rounded-lg bg-panel p-3 text-sm">Отправка из очереди приостановлена. Включите её в настройках, когда будете готовы.</p>}
    {settingsOpen && <MailingSettingsForm repository={repository} initial={overview.settings} onSaved={() => { setSettingsOpen(false); refresh(); }} />}
    <div className="flex flex-wrap items-center justify-between gap-3"><nav aria-label="Разделы рассылок" className="flex max-w-full gap-1 overflow-x-auto pbe-1">{TABS.filter(item => advanced || !item.advanced).map(item => <Button key={item.id} variant={tab === item.id ? 'secondary' : 'ghost'} size="sm" aria-current={tab === item.id ? 'page' : undefined} disabled={busy} onClick={() => choose(item.id)}>{item.label}</Button>)}</nav><Button variant="ghost" size="sm" aria-pressed={advanced} onClick={() => { if (advanced && !['quick', 'history'].includes(tab)) choose('quick'); setAdvanced(value => !value); }} disabled={busy}>{advanced ? 'Простой режим' : 'Расширенный режим'}</Button></div>
    {selectedId ? <MailingCampaignDetails key={selectedId} repository={repository} id={selectedId} onBack={() => { choose('history'); refresh(); }} onEdit={requestEdit} onChanged={refresh} /> : tab === 'history' ? <MailingHistory campaigns={overview.campaigns} onSelect={openCampaign} onEdit={requestEdit} onRefresh={refresh} /> : tab === 'users' ? <MailingAudienceUsers repository={repository} selection={form.input.audience} onSelection={selection} disabled={busy} /> : tab === 'contacts' ? <MailingContacts repository={repository} selection={form.input.audience} onSelection={selection} onChanged={refresh} disabled={busy} /> : tab === 'stoplist' ? <MailingStoplist repository={repository} onChanged={refresh} /> : <>
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2"><div className="min-w-0 space-y-4">{tab === 'quick' ? <QuickMailing overview={overview} input={form.input} update={update} disabled={busy} onCompose={() => choose('compose')} /> : <div className={PANEL}><MailingComposeFields input={form.input} update={update} disabled={busy} /></div>}<div className={PANEL}><MailingChannels overview={overview} value={form.input.channels} onChange={channels => update({ ...form.input, channels })} disabled={busy} />{tab === 'compose' && <div className="mbs-4 flex flex-wrap items-center gap-2 border-bs pbs-3"><span className="text-xs text-muted-foreground">Баз: {form.input.audience.baseIds.length} · Пользователей: {form.input.audience.userIds.length} · Контактов: {form.input.audience.contactIds.length}</span><Button variant="ghost" size="sm" onClick={() => choose('users')}>Выбрать пользователей</Button><Button variant="ghost" size="sm" onClick={() => choose('contacts')}>Выбрать контакты</Button><Button variant="ghost" size="sm" onClick={() => choose('quick')}>Выбрать базы</Button></div>}</div></div><div className="min-w-0 lg:sticky lg:inset-bs-4"><MailingPreviewPane repository={repository} content={form.input.content} /></div></div>
      <div className="space-y-3 border-bs pbs-4"><div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-sm">{reach ? `Получателей: ${reach.recipients} · Отправок: ${reach.deliveries} · Пропущено: ${reach.skipped}` : reachError ? <span className="text-destructive">{reachError} <button type="button" className="underline underline-offset-4" onClick={() => setReachVersion(value => value + 1)}>Повторить расчёт</button></span> : 'Считаем получателей…'}</p><span className="text-xs text-muted-foreground">{form.id ? dirty ? 'Есть несохранённые изменения' : 'Черновик сохранён' : 'Новая рассылка'}</span></div>
      {reach && !reach.deliveries && <p className="text-xs text-muted-foreground">Выберите базу или получателей для доступных каналов. Адреса из стоп-листа исключаются автоматически.</p>}
      {testResults && <ul role="status" className="space-y-1 rounded-lg bg-panel p-3 text-sm">{testResults.map(result => <li key={result.channel}>{CHANNEL_NAMES[result.channel as keyof typeof CHANNEL_NAMES] ?? result.channel}: {result.message}</li>)}</ul>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void run(async () => { await persist(); toast.success('Черновик сохранён'); })}>{busy ? <BusyIcon /> : <Save className="size-4" />}Сохранить черновик</Button><Button variant="outline" disabled={busy || !form.input.channels.length || !form.input.content.body.trim() || !form.input.content.subject.trim()} onClick={() => void run(async () => { const saved = await persist(); setTestResults((await repository.test(saved.id)).results); })}><FlaskConical className="size-4" />Тест себе</Button><Button variant="outline" disabled={!canSend} onClick={() => setLaunchMode('schedule')}><CalendarClock className="size-4" />Запланировать</Button><Button disabled={!canSend} onClick={() => setLaunchMode('now')}><Send className="size-4" />Отправить</Button></div></div>
    </>}
    {switchTo && <ConfirmMailingAction title="Заменить текущий черновик в форме?" description="Несохранённые изменения в форме будут заменены. Сохранённые рассылки останутся в истории." actionLabel="Продолжить" onClose={() => setSwitchTo(null)} onConfirm={async () => { if (switchTo === 'new') newDraft(); else await loadDraft(switchTo); }} />}
    <Dialog open={launchMode !== null} onOpenChange={open => { if (!open && !busy) setLaunchMode(null); }}><DialogContent><DialogHeader><DialogTitle>{launchMode === 'schedule' ? 'Запланировать рассылку' : 'Отправить рассылку сейчас?'}</DialogTitle><DialogDescription>Получателей: {reach?.recipients ?? 0}. Отправок по каналам: {reach?.deliveries ?? 0}. Это реальная рассылка выбранным получателям.</DialogDescription></DialogHeader><p className="text-sm">{form.input.content.subject}</p><p className="text-xs text-muted-foreground">{form.input.channels.map(channel => `${CHANNEL_NAMES[channel]}: ${reach?.byChannel[channel] ?? 0}`).join(' · ')}</p>{launchMode === 'schedule' && <div className="space-y-1.5"><Label htmlFor="mailing-schedule">Дата и время · Москва (UTC+3)</Label><Input id="mailing-schedule" type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} disabled={busy} />{schedule && !validSchedule && <p role="alert" className="text-xs text-destructive">Выберите время не раньше чем через минуту.</p>}</div>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setLaunchMode(null)}>Отмена</Button><Button disabled={busy || (launchMode === 'schedule' && !validSchedule)} onClick={() => void run(async () => {
      const mode = launchMode; const when = mode === 'schedule' ? new Date(`${schedule}+03:00`).toISOString() : null;
      const saved = await persist(); const campaign = await repository.launch(saved.id, saved.revision, when);
      setLaunchMode(null); newDraft(); openCampaign(campaign.id); refresh(); toast.success(mode === 'schedule' ? 'Рассылка запланирована' : 'Рассылка поставлена в очередь');
    })}>{busy && <BusyIcon />}{launchMode === 'schedule' ? 'Запланировать' : 'Подтвердить отправку'}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
