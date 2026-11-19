import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eye, Loader2, Monitor, Smartphone } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import type { MailingContent, MailingPreview as Preview } from '@/domain/mailing/Mailing';
import { PREVIEW_FRAME_WIDTH, canPreview, contentOf, previewZoom, type PreviewDevice } from './mailingFormat';

const DEVICES = [
  { value: 'desktop', label: 'ПК', icon: <Monitor className="size-3.5" /> },
  { value: 'phone', label: 'Телефон', icon: <Smartphone className="size-3.5" /> },
] as const;

function errorText(e: unknown): string {
  const body = (e as { body?: { message?: unknown } } | null)?.body;
  return body && typeof body.message === 'string' ? body.message : 'Не удалось построить предпросмотр';
}

// Live preview of a letter on a desktop (≈600px card) or a phone (375px viewport). The HTML
// comes from the server renderer, so it is byte-for-byte what recipients get; the frame is
// scaled down to fit narrow columns instead of being cut.
export function MailingPreview({ content, className }: { content: MailingContent; className?: string }): React.ReactElement {
  const { mailingRepository } = useContainer();
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(0);
  const [frameHeight, setFrameHeight] = useState(480);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const ready = canPreview(content);
  const key = JSON.stringify(contentOf(content));
  useEffect(() => {
    if (!ready) { setPreview(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    // Debounce typing: one render request after the admin pauses.
    const timer = window.setTimeout(() => {
      mailingRepository.preview(JSON.parse(key) as MailingContent)
        .then((p) => { if (!cancelled) { setPreview(p); setError(null); } })
        .catch((e: unknown) => { if (!cancelled) setError(errorText(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 450);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [key, ready, mailingRepository]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = (): void => setAvailable(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const frameWidth = PREVIEW_FRAME_WIDTH[device];
  const zoom = previewZoom(available - 2, frameWidth);

  // body (not the document) so the height can shrink again when the letter gets shorter.
  const fitHeight = (): void => {
    const body = frameRef.current?.contentDocument?.body;
    if (body) setFrameHeight(Math.max(320, Math.ceil(body.scrollHeight)));
  };
  // Switching devices reflows the same document: measure again on the next frame.
  useEffect(() => {
    const id = window.requestAnimationFrame(fitHeight);
    return () => window.cancelAnimationFrame(id);
  }, [device, preview]);

  return (
    <section className={cn('overflow-clip rounded-lg bg-card shadow-card', className)} aria-label="Предпросмотр письма">
      <div className="flex items-center justify-between gap-2 border-be px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Eye className="size-3.5 shrink-0 text-muted-foreground" />
          Предпросмотр
          {loading && <Loader2 className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin" aria-label="Обновляем" />}
        </div>
        <SegmentedControl size="sm" className="shrink-0" value={device} onChange={setDevice} options={DEVICES} />
      </div>
      {/* Inbox row: what the recipient sees before opening the letter. */}
      <div className="min-w-0 border-be px-3 py-2 sm:px-4">
        <p className="truncate text-sm font-semibold">{preview?.subject || content.subject || 'Тема письма'}</p>
        <p className="truncate text-xs text-muted-foreground">{preview?.preheader || content.preheader || 'Прехедер — строка после темы во входящих'}</p>
      </div>
      <div ref={boxRef} className="max-h-[70dvh] overflow-y-auto bg-muted/40 p-px" data-pf-mailing-preview={device}>
        {!ready ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">Заполните тему и текст — здесь появится письмо</p>
        ) : error && !preview ? (
          <p role="alert" className="px-4 py-16 text-center text-sm text-destructive">{error}</p>
        ) : preview ? (
          <div
            className={cn('mx-auto overflow-clip', device === 'phone' && 'my-3 rounded-2xl ring-1 ring-border')}
            style={{ inlineSize: frameWidth * zoom, blockSize: frameHeight * zoom }}
          >
            {/* Scripts stay disabled; same-origin only lets us read the height to avoid a nested scrollbar. */}
            <iframe
              ref={frameRef}
              title={device === 'phone' ? 'Письмо на телефоне' : 'Письмо на компьютере'}
              srcDoc={preview.html}
              sandbox="allow-same-origin"
              onLoad={fitHeight}
              className="block border-0 bg-white [transform-origin:0_0]"
              style={{ inlineSize: frameWidth, blockSize: frameHeight, transform: zoom < 1 ? `scale(${zoom})` : undefined }}
            />
          </div>
        ) : (
          <div className="flex justify-center px-4 py-16"><Loader2 className="size-5 text-muted-foreground motion-safe:animate-spin" /></div>
        )}
      </div>
    </section>
  );
}
