import { useEffect, useState } from 'react';
import { Eye, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { MailingRepository } from '@/application/mailing/MailingRepository';
import type { MailingContent, MailingDraftInput, MailingOverview, MailingPreview } from '@/domain/mailing/Mailing';
import { MAILING_CHANNELS } from '@/domain/mailing/Mailing';
import { CHANNEL_NAMES, CheckChoice, FIELD, PANEL, SelectField, BusyIcon, errorText } from './ui';

export const MAILING_PRESETS: { id: string; title: string; description: string; content: MailingContent }[] = [
  { id: 'intro', title: 'Знакомство с ProjectsFlow', description: 'Первое письмо новой базе: проекты, задачи и обсуждения в одном месте.', content: {
    kind: 'message', subject: 'Ваши проекты и задачи в ProjectsFlow', preheader: 'Организуйте работу команды в одном пространстве',
    body: 'Здравствуйте, {имя}!\n\nProjectsFlow помогает организовать работу над проектами: назначить исполнителя, описать задачу и обсудить результат в комментариях.\n\nНачните со «Входящих»: соберите задачи и распределите их по проектам. В карточке задачи будут описание, файлы и история обсуждения.\n\nКоманда ProjectsFlow', buttonText: 'Открыть ProjectsFlow', buttonUrl: 'https://projectsflow.ru/',
  } },
  { id: 'return', title: 'Вернуться к задачам', description: 'Напоминание пользователям проверить свои задачи и сообщения команды.', content: {
    kind: 'message', subject: 'Как продвигаются ваши задачи?', preheader: 'Откройте «Входящие» и выберите следующий шаг',
    body: 'Здравствуйте, {имя}!\n\nОткройте ProjectsFlow, чтобы проверить свои задачи и сообщения команды.\n\nЕсли задача уже готова, передайте результат на утверждение. Если нужны детали — задайте вопрос в комментариях: обсуждение останется рядом с задачей.\n\nКоманда ProjectsFlow', buttonText: 'Перейти к задачам', buttonUrl: 'https://projectsflow.ru/inbox',
  } },
  { id: 'team', title: 'Работа вместе с командой', description: 'Письмо о совместной работе над проектами.', content: {
    kind: 'news', subject: 'Соберите команду в ProjectsFlow', preheader: 'Назначайте задачи и обсуждайте результаты рядом с ними',
    body: 'Здравствуйте, {имя}!\n\nВ ProjectsFlow можно работать над проектами вместе: назначать исполнителей, добавлять файлы и обсуждать результат в карточке задачи.\n\nУчастники команды видят работу в общем пространстве. Руководитель может принять готовую задачу или вернуть её на доработку с комментарием.\n\nКоманда ProjectsFlow', buttonText: 'Открыть пространство', buttonUrl: 'https://projectsflow.ru/',
  } },
];
export function emptyMailingDraft(channels: MailingDraftInput['channels'] = ['email']): MailingDraftInput {
  return { title: '', content: { kind: 'message', subject: '', preheader: '', body: '', buttonText: '', buttonUrl: '' }, channels, audience: { userIds: [], contactIds: [], baseIds: [] } };
}
export function MailingPreviewPane({ repository, content }: { repository: MailingRepository; content: MailingContent }) {
  const [preview, setPreview] = useState<MailingPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'html' | 'text'>('html');
  const key = JSON.stringify(content);
  useEffect(() => {
    let active = true; setPreview(null); setError(null);
    const value = JSON.parse(key) as MailingContent;
    if (!value.subject.trim() || !value.body.trim()) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      void repository.preview({ ...emptyMailingDraft(), content: value }).then(result => { if (active) setPreview(result); }).catch(err => { if (active) setError(errorText(err)); }).finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [repository, key]);
  return <section className="min-w-0 overflow-clip rounded-xl bg-card shadow-card" aria-label="Предпросмотр рассылки">
    <div className="flex flex-wrap items-center justify-between gap-2 border-be px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-medium"><Eye className="size-4 text-muted-foreground" />Предпросмотр</h3><SegmentedControl size="sm" value={mode} onChange={setMode} options={[{ value: 'html', label: 'Письмо' }, { value: 'text', label: 'Текст' }]} /></div>
    {preview && <p className="border-be px-4 py-2 text-sm"><span className="text-muted-foreground">Тема: </span>{preview.subject}</p>}
    {loading ? <div role="status" className="grid min-h-72 place-items-center"><span className="flex items-center gap-2 text-sm text-muted-foreground"><BusyIcon />Готовим предпросмотр…</span></div> : error ? <p role="alert" className="p-5 text-sm text-destructive">{error}</p> : preview ? mode === 'html' ? <iframe title="Письмо рассылки" srcDoc={preview.html} sandbox="" referrerPolicy="no-referrer" className="h-[420px] w-full border-0 bg-white" /> : <pre className="max-h-[420px] min-h-72 overflow-auto whitespace-pre-wrap break-words p-4 text-sm leading-relaxed">{preview.text}</pre> : <div className="grid min-h-72 place-items-center p-5 text-center text-sm text-muted-foreground">Выберите готовое письмо или заполните тему и текст в конструкторе.</div>}
    <p className="border-bs px-4 py-2 text-xs text-muted-foreground">Пример на данных вашего аккаунта. В рассылке подставятся данные получателя.</p>
  </section>;
}
export function MailingChannels({ overview, value, onChange, disabled }: { overview: MailingOverview; value: MailingDraftInput['channels']; onChange: (channels: MailingDraftInput['channels']) => void; disabled: boolean }) {
  return <fieldset className="space-y-2" disabled={disabled}><legend className="mbe-2 text-sm font-medium">Каналы</legend><div className="flex flex-wrap gap-x-5 gap-y-3">{MAILING_CHANNELS.map(channel => <CheckChoice key={channel} checked={value.includes(channel)} disabled={!overview.channels[channel] || disabled} onChange={on => onChange(on ? [...value.filter(item => item !== channel), channel] : value.filter(item => item !== channel))}>{CHANNEL_NAMES[channel]}{!overview.channels[channel] && <span className="text-xs text-muted-foreground"> · не подключён</span>}</CheckChoice>)}</div></fieldset>;
}
export function MailingComposeFields({ input, update, disabled }: { input: MailingDraftInput; update: (value: MailingDraftInput) => void; disabled: boolean }) {
  const patch = (value: Partial<MailingContent>) => update({ ...input, content: { ...input.content, ...value } });
  return <div className="space-y-4"><div className="space-y-1.5"><Label htmlFor="mailing-title">Название рассылки</Label><Input id="mailing-title" maxLength={160} value={input.title} onChange={event => update({ ...input, title: event.target.value })} disabled={disabled} placeholder="Видно только в админке" /></div>
    <SelectField label="Вид письма" value={input.content.kind} disabled={disabled} onChange={event => patch({ kind: event.target.value as MailingContent['kind'] })}><option value="message">Личное письмо</option><option value="news">Новость</option><option value="offer">Предложение</option></SelectField>
    <div className="space-y-1.5"><Label htmlFor="mailing-subject">Тема письма</Label><Input id="mailing-subject" maxLength={200} value={input.content.subject} onChange={event => patch({ subject: event.target.value })} disabled={disabled} /></div>
    <div className="space-y-1.5"><Label htmlFor="mailing-preheader">Короткое описание</Label><Input id="mailing-preheader" maxLength={160} value={input.content.preheader} onChange={event => patch({ preheader: event.target.value })} disabled={disabled} placeholder="Показывается рядом с темой в почтовом ящике" /></div>
    <div className="space-y-1.5"><Label htmlFor="mailing-body">Текст рассылки</Label><AutoGrowTextarea id="mailing-body" minRows={8} maxRows={16} maxLength={20_000} value={input.content.body} onChange={event => patch({ body: event.target.value })} disabled={disabled} className={FIELD} /><p className="text-xs text-muted-foreground">Подстановки: {'{имя}'}, {'{компания}'}, {'{email}'}. Для выделения используйте **жирный текст**.</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="mailing-button">Текст кнопки</Label><Input id="mailing-button" maxLength={100} value={input.content.buttonText} onChange={event => patch({ buttonText: event.target.value })} disabled={disabled} /></div><div className="space-y-1.5"><Label htmlFor="mailing-url">Адрес кнопки</Label><Input id="mailing-url" type="url" maxLength={2000} value={input.content.buttonUrl} onChange={event => patch({ buttonUrl: event.target.value })} disabled={disabled} placeholder="https://projectsflow.ru/" /></div></div>
  </div>;
}
export function QuickMailing({ overview, input, update, disabled, onCompose }: { overview: MailingOverview; input: MailingDraftInput; update: (value: MailingDraftInput) => void; disabled: boolean; onCompose: () => void }) {
  const bases = input.audience.baseIds;
  return <div className="space-y-5"><section className={PANEL}><h3 className="mbe-3 text-sm font-medium">Кому отправить</h3>{overview.bases.length ? <div className="max-h-72 space-y-3 overflow-y-auto">{overview.bases.map(base => <div key={base.id}><CheckChoice checked={bases.includes(base.id)} disabled={disabled || !base.total} onChange={on => update({ ...input, audience: { ...input.audience, baseIds: on ? [...bases, base.id] : bases.filter(id => id !== base.id) } })}>{base.title}<span className="ms-2 text-muted-foreground tabular-nums">{base.total}</span></CheckChoice><p className="mbs-1 ps-6 text-xs text-muted-foreground">{base.description}</p></div>)}</div> : <p className="text-sm text-muted-foreground">Пока нет получателей. Добавьте контакты или дождитесь регистрации пользователей.</p>}
      {(input.audience.userIds.length > 0 || input.audience.contactIds.length > 0) && <p className="mbs-3 text-xs text-muted-foreground">Дополнительно выбрано вручную: пользователей — {input.audience.userIds.length}, контактов — {input.audience.contactIds.length}.</p>}
    </section><section className={PANEL}><h3 className="mbe-3 text-sm font-medium">Готовое письмо</h3><div className="space-y-2">{MAILING_PRESETS.map(preset => <button type="button" key={preset.id} disabled={disabled} aria-pressed={input.content.subject === preset.content.subject} onClick={() => update({ ...input, title: preset.title, content: { ...preset.content } })} className={`w-full rounded-lg border p-3 text-start transition-colors disabled:opacity-50 ${input.content.subject === preset.content.subject ? 'border-primary bg-primary-soft' : 'border-border hover:bg-hover'}`}><span className="block text-sm font-medium">{preset.title}</span><span className="mbs-1 block text-xs leading-relaxed text-muted-foreground">{preset.description}</span></button>)}</div><Button variant="ghost" size="sm" className="mbs-3" onClick={onCompose} disabled={disabled}><PenLine className="size-4" />Изменить письмо в конструкторе</Button></section>
  </div>;
}
