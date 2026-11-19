import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Loader2, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { EmailPreview, EmailTemplateMeta } from '@/application/admin/AdminRepository';
import { useContainer } from '@/infrastructure/di/container';
import { ADMIN_LIST_CLASS, AdminError, AdminLoading, errorText } from './AdminState';

const PREVIEW_MODES = [
  { value: 'html', label: 'HTML' },
  { value: 'text', label: 'Текст' },
] as const;

// «Email»: системные письма платформы — предпросмотр и тестовая отправка с демо-данными.
export function AdminEmailTab(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [templates, setTemplates] = useState<EmailTemplateMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<'html' | 'text'>('html');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback((): void => {
    setError(null);
    adminRepository.listEmailTemplates()
      .then((t) => {
        setTemplates(t);
        setSelected((current) => current ?? t[0]?.key ?? null);
      })
      .catch((e: unknown) => setError(errorText(e, 'Не удалось загрузить шаблоны писем')));
  }, [adminRepository]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!selected) return;
    setLoadingPreview(true);
    setPreview(null);
    adminRepository.previewEmail(selected)
      .then(setPreview)
      .catch((e: unknown) => toast.error(errorText(e, 'Не удалось загрузить предпросмотр')))
      .finally(() => setLoadingPreview(false));
  }, [selected, adminRepository]);

  useEffect(() => {
    if (!preview || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (doc) {
      doc.open();
      doc.write(preview.html);
      doc.close();
    }
  }, [preview, mode]);

  const handleSend = async (): Promise<void> => {
    if (!selected || !recipientEmail.trim()) return;
    setSending(true);
    try {
      await adminRepository.sendTestEmail(selected, recipientEmail.trim());
      toast.success(`Тестовое письмо отправлено на ${recipientEmail.trim()}`);
    } catch (e) {
      toast.error(errorText(e, 'Не удалось отправить письмо'));
    } finally {
      setSending(false);
    }
  };

  if (error) return <AdminError message={error} onRetry={load} />;
  if (!templates) return <AdminLoading rows={6} />;

  const selectedMeta = templates.find((t) => t.key === selected);

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Шаблоны писем" className="min-w-0">
        <h2 className="mbe-1.5 text-meta text-muted-foreground">Шаблоны · {templates.length}</h2>
        <ul className={cn(ADMIN_LIST_CLASS, 'max-h-64 overflow-y-auto lg:max-h-[calc(100dvh-14rem)]')}>
          {templates.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => setSelected(t.key)}
                aria-current={selected === t.key ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-start text-ui transition-colors max-sm:min-h-11',
                  selected === t.key ? 'bg-primary-soft text-primary-ink' : 'hover:bg-hover',
                )}
              >
                <Mail className="size-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col gap-3">
        {selectedMeta && (
          <div>
            <h2 className="text-task font-medium">{selectedMeta.label}</h2>
            <p className="text-meta text-muted-foreground">{selectedMeta.description}</p>
          </div>
        )}
        <section className="overflow-clip rounded-lg bg-card shadow-card" aria-label="Предпросмотр">
          <div className="flex items-center justify-between gap-2 border-be px-3 py-1.5">
            <p className="flex min-w-0 items-center gap-2 text-meta">
              <Eye className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-muted-foreground">{preview?.subject ?? 'Предпросмотр'}</span>
            </p>
            <SegmentedControl size="sm" className="shrink-0" value={mode} onChange={setMode} options={PREVIEW_MODES} />
          </div>
          {loadingPreview || !preview ? (
            <div className="grid h-[360px] place-items-center">
              <Loader2 className="size-5 text-muted-foreground motion-safe:animate-spin" />
            </div>
          ) : mode === 'text' ? (
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-muted-foreground">{preview.text}</pre>
          ) : (
            // Белый холст независимо от темы: письма свёрстаны под белый фон почтовых клиентов.
            <iframe ref={iframeRef} title="Предпросмотр письма" className="h-[480px] w-full border-0 bg-white" sandbox="" />
          )}
        </section>

        <form className="flex flex-wrap items-end gap-2 rounded-lg bg-card p-3 shadow-card"
          onSubmit={(e) => { e.preventDefault(); void handleSend(); }}>
          <div className="min-w-0 flex-1 basis-56 space-y-1">
            <Label htmlFor="test-email-recipient" className="text-meta">Тестовая отправка с демо-данными</Label>
            <Input id="test-email-recipient" type="email" placeholder="test@example.com" value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)} />
          </div>
          <Button type="submit" disabled={sending || !selected || !recipientEmail.trim()}>
            {sending ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Send className="size-4" />}
            Отправить
          </Button>
        </form>
      </div>
    </div>
  );
}
