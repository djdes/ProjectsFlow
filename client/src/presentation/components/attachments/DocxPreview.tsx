import { useEffect, useRef, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';

// Word-документ (.docx) прямо в просмотрщике: файл берём тем же адресом, что и «Скачать», и
// рисуем страницами через docx-preview. Библиотека грузится отдельным чанком только при
// открытии .docx — остальному интерфейсу она ничего не стоит.
export function DocxPreview({ attachment }: { attachment: TaskAttachment }): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    setState('loading');
    node.replaceChildren();
    void (async () => {
      const [response, docx] = await Promise.all([fetch(attachment.url), import('docx-preview')]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (cancelled) return;
      await docx.renderAsync(blob, node, undefined, {
        inWrapper: true,
        ignoreLastRenderedPageBreak: true,
        useBase64URL: true,
        renderComments: false,
      });
      if (cancelled) return;
      neutralizeLinks(node);
      fitToWidth(node);
      setState('ready');
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.warn('[docx-preview] render failed:', error);
      setState('failed');
    });
    // Ширина окна меняется (поворот телефона, ресайз) — страницы снова вписываем по ширине.
    // Только по ширине: масштаб меняет высоту, и реакция на неё зациклила бы наблюдатель.
    let lastWidth = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === lastWidth) return;
      lastWidth = node.clientWidth;
      fitToWidth(node);
    });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [attachment.url, attempt]);

  return (
    <div className="relative size-full overflow-auto overscroll-contain">
      {state === 'loading' && (
        <Skeleton className="absolute inset-6 rounded-xl" aria-label="Загрузка документа" />
      )}
      {state === 'failed' && (
        <div
          role="status"
          className="grid h-full place-content-center justify-items-center gap-3 px-6 text-center"
        >
          <FileWarning className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Не удалось открыть документ. Скачайте файл, чтобы посмотреть его.
          </p>
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </Button>
        </div>
      )}
      <div
        ref={host}
        className="pf-docx"
        aria-label={'Документ ' + attachment.filename}
        hidden={state === 'failed'}
      />
    </div>
  );
}

// Ссылки из документа: только http(s) и почта, и всегда в новой вкладке — чужой файл не должен
// уводить из приложения или запускать javascript:-адрес.
function neutralizeLinks(root: HTMLElement): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    if (/^(https?:|mailto:)/i.test(href)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else if (!href.startsWith('#')) {
      link.removeAttribute('href');
    }
  }
}

// Страница Word шире телефона: масштабируем её под ширину окна, а не заставляем листать вбок.
function fitToWidth(root: HTMLElement): void {
  const wrapper = root.querySelector<HTMLElement>('.docx-wrapper');
  const page = wrapper?.querySelector<HTMLElement>('section.docx');
  if (!wrapper || !page) return;
  wrapper.style.zoom = '';
  // Ширину берём у страницы, а не у обёртки: обёртка центрирует страницу, и её scrollWidth
  // не видит часть, ушедшую влево, — страница обрезалась бы слева.
  const style = getComputedStyle(wrapper);
  const needed = page.offsetWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const available = root.clientWidth;
  if (available > 0 && needed > available) wrapper.style.zoom = String(available / needed);
}
