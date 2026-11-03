import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FilePlus2, Loader2, Mail, Megaphone, Save, Send, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/relativeTime';
import { useContainer } from '@/infrastructure/di/container';
import { MAILING_OFFER_LIMITS, type MailingStarter, type MailingTemplate, type MailingTemplateDraft } from '@/domain/mailing/Mailing';
import { RichTextEditor } from '@/presentation/components/editor/RichTextEditor';
import { MailingPreview } from './MailingPreview';
import { MailingLayoutPicker } from './MailingLayoutPicker';
import { EMPTY_DRAFT, canPreview, contentOf, offerOf, sameDraft, variableHints } from './mailingFormat';

type Selection = { kind: 'template'; id: string } | { kind: 'new'; starterKey: string | null };

export function mailingErrorText(e: unknown, fallback: string): string {
  const body = (e as { body?: { message?: unknown } } | null)?.body;
  if (body && typeof body.message === 'string') return body.message;
  return e instanceof Error && e.message ? e.message : fallback;
}

const draftOf = (t: MailingTemplateDraft): MailingTemplateDraft => ({
  name: t.name, subject: t.subject, preheader: t.preheader, bodyMarkdown: t.bodyMarkdown, ctaLabel: t.ctaLabel, ctaUrl: t.ctaUrl,
  // Templates from before layouts existed come without these fields.
  layout: t.layout ?? 'standard', offer: t.offer ?? null,
});

const ROW_CLASS = 'flex w-full items-start gap-2 px-3 py-2.5 text-start text-sm transition-colors';
const LIST_CLASS = 'divide-y divide-border overflow-clip rounded-lg bg-card shadow-card';

// Template library: saved templates and built-in starters on the left, the editor with a
// live desktop/phone preview on the right. On phones it is master–detail: the list or the
// editor, with a back button.
export function MailingTemplatesView({ onUseTemplate }: { onUseTemplate: (templateId: string) => void }): React.ReactElement {
  const { mailingRepository } = useContainer();
  const [templates, setTemplates] = useState<MailingTemplate[] | null>(null);
  const [starters, setStarters] = useState<MailingStarter[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<MailingTemplateDraft>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState<MailingTemplateDraft>(EMPTY_DRAFT);
  // Remounts the rich-text editor when another template is opened (it keeps its own state).
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState<'save' | 'delete' | 'test' | null>(null);

  useEffect(() => {
    mailingRepository.listTemplates()
      .then((r) => { setTemplates(r.templates); setStarters(r.starters); })
      .catch((e: unknown) => toast.error(mailingErrorText(e, 'Не удалось загрузить шаблоны')));
  }, [mailingRepository]);

  const open = useCallback((next: Selection, value: MailingTemplateDraft): void => {
    setSelection(next);
    setDraft(value);
    setBaseline(next.kind === 'template' ? value : EMPTY_DRAFT);
    setEditorKey((k) => k + 1);
  }, []);

  const dirty = !sameDraft(draft, baseline);
  const patch = (p: Partial<MailingTemplateDraft>): void => setDraft((d) => ({ ...d, ...p }));
  const patchOffer = (p: Partial<{ badge: string; deadline: string; caption: string }>): void =>
    setDraft((d) => ({ ...d, offer: { badge: '', deadline: '', ...d.offer, ...p } }));
  const confirmLeave = (): boolean => !dirty || window.confirm('Есть несохранённые изменения. Закрыть без сохранения?');

  const save = async (): Promise<void> => {
    if (!selection || busy) return;
    setBusy('save');
    try {
      const value = { ...draft, ctaLabel: draft.ctaLabel || null, ctaUrl: draft.ctaUrl || null, offer: offerOf(draft.layout, draft.offer) };
      const saved = selection.kind === 'template'
        ? await mailingRepository.updateTemplate(selection.id, value)
        : await mailingRepository.createTemplate(value);
      setTemplates((list) => [saved, ...(list ?? []).filter((t) => t.id !== saved.id)]);
      setSelection({ kind: 'template', id: saved.id });
      setDraft(draftOf(saved));
      setBaseline(draftOf(saved));
      toast.success('Шаблон сохранён');
    } catch (e) {
      toast.error(mailingErrorText(e, 'Не удалось сохранить шаблон'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (selection?.kind !== 'template' || busy) return;
    if (!window.confirm(`Удалить шаблон «${baseline.name}»? Уже отправленные рассылки сохранятся.`)) return;
    setBusy('delete');
    try {
      await mailingRepository.deleteTemplate(selection.id);
      setTemplates((list) => (list ?? []).filter((t) => t.id !== selection.id));
      setSelection(null);
      toast.success('Шаблон удалён');
    } catch (e) {
      toast.error(mailingErrorText(e, 'Не удалось удалить шаблон'));
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async (): Promise<void> => {
    if (busy) return;
    setBusy('test');
    try {
      const { to } = await mailingRepository.sendTest(contentOf(draft));
      toast.success(`Тестовое письмо отправлено на ${to}`);
    } catch (e) {
      toast.error(mailingErrorText(e, 'Не удалось отправить тест'));
    } finally {
      setBusy(null);
    }
  };

  const copyToken = (token: string): void => {
    void navigator.clipboard?.writeText(token).then(
      () => toast.success(`${token} скопировано — вставьте в текст`),
      () => toast.message(`Вставьте в текст: ${token}`),
    );
  };

  if (!templates) {
    return (
      <LoadingRegion className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
      </LoadingRegion>
    );
  }

  const isSelected = (s: Selection): boolean =>
    selection?.kind === s.kind && (s.kind === 'template' ? selection.kind === 'template' && selection.id === s.id
      : selection.kind === 'new' && selection.starterKey === s.starterKey);
  const valid = draft.name.trim() && draft.subject.trim() && draft.bodyMarkdown.trim();

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className={cn('min-w-0 space-y-4', selection && 'max-lg:hidden')} aria-label="Шаблоны писем">
        <Button className="w-full" onClick={() => confirmLeave() && open({ kind: 'new', starterKey: null }, EMPTY_DRAFT)}>
          <FilePlus2 className="size-4" /> Новый шаблон
        </Button>
        <div>
          <h3 className="mbe-2 text-ui font-medium text-muted-foreground">Мои шаблоны ({templates.length})</h3>
          {templates.length === 0 ? (
            <p className="rounded-lg bg-card px-3 py-4 text-sm text-muted-foreground shadow-card">
              Пока пусто. Начните с заготовки ниже — её можно поправить и сохранить.
            </p>
          ) : (
            <ul className={LIST_CLASS}>
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    aria-current={isSelected({ kind: 'template', id: t.id }) ? 'true' : undefined}
                    onClick={() => confirmLeave() && open({ kind: 'template', id: t.id }, draftOf(t))}
                    className={cn(ROW_CLASS, isSelected({ kind: 'template', id: t.id }) ? 'bg-primary-soft text-primary-ink' : 'hover:bg-hover')}
                  >
                    <Mail className="mbs-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">изменён {relativeTime(new Date(t.updatedAt))}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mbe-2 text-ui font-medium text-muted-foreground">Заготовки</h3>
          <ul className={LIST_CLASS}>
            {starters.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  aria-current={isSelected({ kind: 'new', starterKey: s.key }) ? 'true' : undefined}
                  onClick={() => confirmLeave() && open({ kind: 'new', starterKey: s.key }, draftOf(s))}
                  className={cn(ROW_CLASS, isSelected({ kind: 'new', starterKey: s.key }) ? 'bg-primary-soft text-primary-ink' : 'hover:bg-hover')}
                >
                  <Sparkles className="mbs-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">{s.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {selection ? (
        <div className="grid min-w-0 items-start gap-4 2xl:grid-cols-2">
          <section className="min-w-0 space-y-4 rounded-lg bg-card p-3 shadow-card sm:p-4" aria-label="Редактор шаблона">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="-ms-2 lg:hidden" onClick={() => confirmLeave() && setSelection(null)}>
                <ArrowLeft className="size-4" /> Шаблоны
              </Button>
              <h3 className="min-w-0 flex-1 truncate text-sm font-medium max-lg:text-end">
                {selection.kind === 'template' ? 'Шаблон' : 'Новый шаблон'}{dirty && <span className="text-muted-foreground"> · не сохранён</span>}
              </h3>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mailing-name">Название шаблона</Label>
              <Input id="mailing-name" value={draft.name} maxLength={120} placeholder="Например, «Новость: доски»"
                onChange={(e) => patch({ name: e.target.value })} />
            </div>
            <MailingLayoutPicker value={draft.layout} onChange={(layout) => patch({ layout })} />
            {draft.layout !== 'standard' && (
              <div className="space-y-1.5" data-pf-mailing-offer>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="mailing-offer-caption">Подпись</Label>
                    <Input id="mailing-offer-caption" value={draft.offer?.caption ?? ''} maxLength={MAILING_OFFER_LIMITS.caption} placeholder="как в макете"
                      onChange={(e) => patchOffer({ caption: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mailing-offer-badge">Предложение</Label>
                    <Input id="mailing-offer-badge" value={draft.offer?.badge ?? ''} maxLength={MAILING_OFFER_LIMITS.badge} placeholder="7 дней"
                      onChange={(e) => patchOffer({ badge: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mailing-offer-deadline">Срок</Label>
                    <Input id="mailing-offer-deadline" value={draft.offer?.deadline ?? ''} maxLength={MAILING_OFFER_LIMITS.deadline} placeholder="до 30 ноября"
                      onChange={(e) => patchOffer({ deadline: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Крупная строка под картинкой и переменные {'{{offer}}'} и {'{{deadline}}'}. Это только текст: тариф выдаётся вручную в разделе «Пользователи».
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="mailing-subject">Тема письма</Label>
              <Input id="mailing-subject" value={draft.subject} maxLength={200} placeholder="{{name}}, у нас новости"
                onChange={(e) => patch({ subject: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mailing-preheader">Прехедер</Label>
              <Input id="mailing-preheader" value={draft.preheader} maxLength={200} placeholder="Строка после темы во входящих"
                onChange={(e) => patch({ preheader: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Текст письма</span>
              <div className="min-h-40 rounded-md border bg-background px-3 py-2" data-pf-mailing-body>
                <RichTextEditor
                  key={editorKey}
                  value={draft.bodyMarkdown}
                  onChange={(markdown) => patch({ bodyMarkdown: markdown })}
                  variant="description"
                  toolbar
                  placeholder="Здравствуйте, {{name}}! …"
                />
              </div>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                Переменные:
                {variableHints(draft.layout).map((v) => (
                  <button key={v.token} type="button" onClick={() => copyToken(v.token)}
                    className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-foreground hover:bg-hover" title={`Скопировать — ${v.label}`}>
                    {v.token}
                  </button>
                ))}
                <span>· запасное значение: <code className="font-mono">{'{{name|коллега}}'}</code></span>
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mailing-cta-label">Кнопка</Label>
                <Input id="mailing-cta-label" value={draft.ctaLabel ?? ''} maxLength={80} placeholder="Без кнопки"
                  onChange={(e) => patch({ ctaLabel: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mailing-cta-url">Ссылка кнопки</Label>
                <Input id="mailing-cta-url" type="url" inputMode="url" value={draft.ctaUrl ?? ''} maxLength={500} placeholder="https://projectsflow.ru/"
                  onChange={(e) => patch({ ctaUrl: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={busy !== null || !dirty || !valid}>
                {busy === 'save' ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Save className="size-4" />}
                Сохранить
              </Button>
              <Button variant="outline" onClick={() => void sendTest()} disabled={busy !== null || !canPreview(draft)}>
                {busy === 'test' ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Send className="size-4" />}
                Отправить тест себе
              </Button>
              {selection.kind === 'template' && (
                <>
                  <Button variant="outline" onClick={() => onUseTemplate(selection.id)} disabled={busy !== null || dirty}
                    title={dirty ? 'Сначала сохраните шаблон' : undefined}>
                    <Megaphone className="size-4" /> Создать рассылку
                  </Button>
                  <Button variant="ghost" className="text-destructive" onClick={() => void remove()} disabled={busy !== null}>
                    <Trash2 className="size-4" /> Удалить
                  </Button>
                </>
              )}
            </div>
          </section>
          <MailingPreview content={draft} className="2xl:sticky 2xl:inset-bs-4" />
        </div>
      ) : (
        <p className="rounded-lg bg-card px-4 py-16 text-center text-sm text-muted-foreground shadow-card max-lg:hidden">
          Выберите шаблон или заготовку слева
        </p>
      )}
    </div>
  );
}
