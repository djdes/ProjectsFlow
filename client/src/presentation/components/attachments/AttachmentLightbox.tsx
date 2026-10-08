import { useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  ImageOff,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { formatBytes, isImageFile, isMp4File } from './files';

export function AttachmentLightbox({
  attachment,
  attachments = [],
  onClose,
}: {
  attachment: TaskAttachment | null;
  attachments?: readonly TaskAttachment[];
  onClose: () => void;
}): React.ReactElement {
  const items =
    attachment && !attachments.some((item) => item.id === attachment.id)
      ? [attachment]
      : attachments;
  return (
    <Dialog
      open={attachment !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      {attachment && (
        <AttachmentGallery
          key={attachment.id}
          initialId={attachment.id}
          items={items}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function AttachmentGallery({
  initialId,
  items,
  onClose,
}: {
  initialId: string;
  items: readonly TaskAttachment[];
  onClose: () => void;
}): React.ReactElement {
  const [activeId, setActiveId] = useState(initialId);
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );
  const attachment = items[index];
  const [zoomed, setZoomed] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const select = (next: number): void => {
    if (!items[next]) return;
    setActiveId(items[next].id);
    setZoomed(false);
  };
  if (!attachment)
    return (
      <DialogContent>
        <DialogTitle>Вложение недоступно</DialogTitle>
      </DialogContent>
    );
  const image = isImageFile(attachment.mimeType, attachment.filename);
  const mp4 = isMp4File(attachment.mimeType, attachment.filename);
  return (
    <DialogContent
      hideClose
      aria-describedby={undefined}
      className="pf-gallery flex max-h-[92dvh] max-w-5xl flex-col gap-0 overflow-hidden p-0"
      onKeyDown={(event) => {
        if (
          zoomed ||
          (event.target as Element).closest('video, input, textarea')
        )
          return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          select(index + (event.key === 'ArrowLeft' ? -1 : 1));
        }
      }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <DialogTitle
            className="truncate text-sm leading-5"
            title={attachment.filename}
          >
            {attachment.filename}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {formatBytes(attachment.sizeBytes)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          onClick={onClose}
          aria-label="Закрыть просмотр"
        >
          <X className="size-5" />
        </Button>
      </header>
      <div
        className="pf-gallery-stage"
        data-pf-no-swipe
        data-pf-no-edge-swipe
        style={{ touchAction: zoomed || mp4 ? 'auto' : 'pan-y pinch-zoom' }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          swipe.current =
            !zoomed && !mp4 && event.touches.length === 1 && touch
              ? { x: touch.clientX, y: touch.clientY }
              : null;
        }}
        onTouchMove={(event) => {
          if (event.touches.length !== 1) swipe.current = null;
        }}
        onTouchCancel={() => {
          swipe.current = null;
        }}
        onTouchEnd={(event) => {
          const start = swipe.current;
          swipe.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch || event.touches.length) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4)
            select(index + (dx < 0 ? 1 : -1));
        }}
      >
        {image ? (
          <GalleryImage
            key={attachment.id}
            attachment={attachment}
            zoomed={zoomed}
            onToggleZoom={() => setZoomed((value) => !value)}
          />
        ) : mp4 ? (
          <video
            key={attachment.id}
            src={attachment.url}
            controls
            playsInline
            preload="metadata"
            className="size-full object-contain"
            aria-label={'Видео ' + attachment.filename}
          />
        ) : (
          <div className="grid h-full place-content-center justify-items-center gap-3 px-6 text-center">
            <FileText className="size-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Предпросмотр недоступен. Скачайте файл, чтобы открыть его.
            </p>
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            disabled={index === 0}
            onClick={() => select(index - 1)}
            aria-label="Предыдущее вложение"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <span
            className="min-w-12 text-center text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            {index + 1} / {items.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            disabled={index === items.length - 1}
            onClick={() => select(index + 1)}
            aria-label="Следующее вложение"
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {image && (
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-pressed={zoomed}
              onClick={() => setZoomed((value) => !value)}
              aria-label={
                zoomed ? 'Уменьшить изображение' : 'Увеличить изображение'
              }
            >
              {zoomed ? (
                <ZoomOut className="size-5" />
              ) : (
                <ZoomIn className="size-5" />
              )}
            </Button>
          )}
          <Button asChild variant="ghost" size="icon" className="size-11">
            <a
              href={attachment.url}
              download={attachment.filename}
              aria-label="Скачать вложение"
            >
              <Download className="size-5" />
            </a>
          </Button>
        </div>
      </footer>
    </DialogContent>
  );
}

function GalleryImage({
  attachment,
  zoomed,
  onToggleZoom,
}: {
  attachment: TaskAttachment;
  zoomed: boolean;
  onToggleZoom: () => void;
}): React.ReactElement {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (node) {
      node.scrollLeft = zoomed ? (node.scrollWidth - node.clientWidth) / 2 : 0;
      node.scrollTop = zoomed ? (node.scrollHeight - node.clientHeight) / 2 : 0;
    }
  }, [zoomed]);
  return (
    <div ref={viewport} className="pf-gallery-image" data-zoomed={zoomed}>
      {!loaded && !failed && (
        <Skeleton
          className="absolute inset-6 rounded-xl"
          aria-label="Загрузка изображения"
        />
      )}
      {failed ? (
        <div
          role="status"
          className="grid h-full place-content-center justify-items-center gap-3 px-4 text-center"
        >
          <ImageOff className="size-8 text-muted-foreground" />
          <p className="text-sm">Не удалось загрузить изображение</p>
          <Button
            variant="outline"
            onClick={() => {
              setFailed(false);
              setLoaded(false);
              setAttempt((value) => value + 1);
            }}
          >
            Повторить
          </Button>
        </div>
      ) : (
        <div
          className="pf-gallery-image-canvas"
          style={{
            width: zoomed ? '200%' : '100%',
            height: zoomed ? '200%' : '100%',
          }}
        >
          <img
            key={attempt}
            src={attachment.url}
            alt={attachment.filename}
            draggable={false}
            className="size-full object-contain"
            style={{
              opacity: loaded ? 1 : 0,
              cursor: zoomed ? 'zoom-out' : 'zoom-in',
            }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            onDoubleClick={onToggleZoom}
          />
        </div>
      )}
    </div>
  );
}
