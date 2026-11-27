import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Download,
  FileText,
  ImageOff,
  Loader2,
  MoveUpRight,
  Pencil,
  Send,
  Square,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { formatBytes, isDocxFile, isImageFile, isMp4File } from './files';
import { DocxPreview } from './DocxPreview';

export type DrawTool = 'pen' | 'arrow' | 'rect';

export type NormalizedPoint = {
  readonly x: number;
  readonly y: number;
};

export type DrawStroke = {
  readonly tool: DrawTool;
  readonly color: string;
  readonly points: readonly NormalizedPoint[];
};

const ANNOTATION_COLORS: ReadonlyArray<{
  readonly value: string;
  readonly label: string;
}> = [
  { value: '#ef4444', label: 'Красный цвет' },
  { value: '#facc15', label: 'Жёлтый цвет' },
  { value: '#22c55e', label: 'Зелёный цвет' },
  { value: '#38bdf8', label: 'Голубой цвет' },
  { value: '#ffffff', label: 'Белый цвет' },
];

export function renderAnnotationStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly DrawStroke[],
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (strokes.length === 0 || width <= 0 || height <= 0) return;

  const baseUnit = Math.max(3, Math.round(Math.min(width, height) * 0.0065));

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = baseUnit;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = Math.max(2, baseUnit * 0.75);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;

    const toPx = (pt: NormalizedPoint): { x: number; y: number } => ({
      x: pt.x * width,
      y: pt.y * height,
    });

    if (stroke.tool === 'pen') {
      const first = toPx(stroke.points[0]!);
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(first.x, first.y, baseUnit * 0.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < stroke.points.length - 1; i += 1) {
          const cur = toPx(stroke.points[i]!);
          const next = toPx(stroke.points[i + 1]!);
          const midX = (cur.x + next.x) / 2;
          const midY = (cur.y + next.y) / 2;
          ctx.quadraticCurveTo(cur.x, cur.y, midX, midY);
        }
        const last = toPx(stroke.points[stroke.points.length - 1]!);
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
    } else if (stroke.tool === 'arrow') {
      const start = toPx(stroke.points[0]!);
      const end = toPx(stroke.points[stroke.points.length - 1]!);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.hypot(dx, dy);
      if (len >= 2) {
        const angle = Math.atan2(dy, dx);
        const headLen = Math.min(len * 0.55, Math.max(baseUnit * 4.2, 16));
        const headAngle = Math.PI / 6.5;

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLen * Math.cos(angle - headAngle),
          end.y - headLen * Math.sin(angle - headAngle),
        );
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLen * Math.cos(angle + headAngle),
          end.y - headLen * Math.sin(angle + headAngle),
        );
        ctx.stroke();
      }
    } else if (stroke.tool === 'rect') {
      const start = toPx(stroke.points[0]!);
      const end = toPx(stroke.points[stroke.points.length - 1]!);
      const rx = Math.min(start.x, end.x);
      const ry = Math.min(start.y, end.y);
      const rw = Math.abs(end.x - start.x);
      const rh = Math.abs(end.y - start.y);
      if (rw >= 2 || rh >= 2) {
        const radius = Math.min(10, rw / 4, rh / 4);
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(rx, ry, rw, rh, radius);
        } else {
          ctx.rect(rx, ry, rw, rh);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

function buildAnnotatedFilename(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, '').trim() || 'image';
  return `${base}-пометки.png`;
}

export async function exportAnnotatedImageFile(
  img: HTMLImageElement,
  strokes: readonly DrawStroke[],
  originalFilename: string,
): Promise<File> {
  const width = img.naturalWidth || img.width || 800;
  const height = img.naturalHeight || img.height || 600;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось инициализировать холст');

  // Сначала рисуем штрихи, затем подкладываем исходный снимок снизу (destination-over),
  // чтобы не пересоздавать второй холст.
  renderAnnotationStrokes(ctx, strokes, width, height);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.drawImage(img, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Не удалось сохранить изображение'));
    }, 'image/png');
  });

  return new File([blob], buildAnnotatedFilename(originalFilename), {
    type: 'image/png',
  });
}

export function AttachmentLightbox({
  attachment,
  attachments = [],
  onClose,
  onReplyWithImage,
  onAttachToDraft,
  replyAuthorName,
  attachActionLabel,
}: {
  attachment: TaskAttachment | null;
  attachments?: readonly TaskAttachment[];
  onClose: () => void;
  // Быстрая отправка помеченной картинки одним нажатием прямо ответом в чат/комментарии.
  onReplyWithImage?: (file: File, commentText: string) => Promise<void> | void;
  // Прикрепить помеченную картинку к черновику композера (или обновить вложение в черновике).
  onAttachToDraft?: (file: File) => void;
  replyAuthorName?: string;
  attachActionLabel?: string;
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
          onReplyWithImage={onReplyWithImage}
          onAttachToDraft={onAttachToDraft}
          replyAuthorName={replyAuthorName}
          attachActionLabel={attachActionLabel}
        />
      )}
    </Dialog>
  );
}

// Полупрозрачная плавающая кнопка управления вне картинки (все кнопки >= 44x44px для тач-целей).
const FLOATING_ICON_BTN =
  'grid size-11 shrink-0 place-items-center rounded-full bg-black/55 text-white/90 backdrop-blur-md transition-colors hover:bg-black/80 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-35';

function AttachmentGallery({
  initialId,
  items,
  onClose,
  onReplyWithImage,
  onAttachToDraft,
  replyAuthorName,
  attachActionLabel,
}: {
  initialId: string;
  items: readonly TaskAttachment[];
  onClose: () => void;
  onReplyWithImage?: (file: File, commentText: string) => Promise<void> | void;
  onAttachToDraft?: (file: File) => void;
  replyAuthorName?: string;
  attachActionLabel?: string;
}): React.ReactElement {
  const [activeId, setActiveId] = useState(initialId);
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );
  const attachment = items[index];
  const [zoomed, setZoomed] = useState(false);

  // Состояние рисования на изображении: красный маркер готов сразу, чтобы можно было
  // без лишних кликов обвести нужное место на скриншоте и одним нажатием отправить ответом.
  const [tool, setTool] = useState<DrawTool>('pen');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]!.value);
  const [strokesById, setStrokesById] = useState<Record<string, readonly DrawStroke[]>>({});
  const [touchDrawArmed, setTouchDrawArmed] = useState(false);
  const [replyCaption, setReplyCaption] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const imageElementRef = useRef<HTMLImageElement | null>(null);

  const currentStrokes = attachment ? (strokesById[attachment.id] ?? []) : [];
  const hasStrokes = currentStrokes.length > 0;

  const pushStroke = useCallback(
    (stroke: DrawStroke): void => {
      if (!attachment) return;
      setStrokesById((prev) => ({
        ...prev,
        [attachment.id]: [...(prev[attachment.id] ?? []), stroke],
      }));
    },
    [attachment],
  );

  const undoStroke = useCallback((): void => {
    if (!attachment) return;
    setStrokesById((prev) => {
      const list = prev[attachment.id] ?? [];
      if (list.length === 0) return prev;
      return { ...prev, [attachment.id]: list.slice(0, -1) };
    });
  }, [attachment]);

  const clearStrokes = useCallback((): void => {
    if (!attachment) return;
    setStrokesById((prev) => {
      if (!(prev[attachment.id]?.length)) return prev;
      return { ...prev, [attachment.id]: [] };
    });
  }, [attachment]);

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const select = (next: number): void => {
    if (!items[next]) return;
    setActiveId(items[next].id);
    setZoomed(false);
  };

  const handleSendAnnotatedReply = async (): Promise<void> => {
    if (!attachment || !onReplyWithImage || !imageElementRef.current || sendingReply) return;
    setSendingReply(true);
    try {
      const file = await exportAnnotatedImageFile(
        imageElementRef.current,
        currentStrokes,
        attachment.filename,
      );
      const caption = replyCaption.trim();
      onClose();
      await onReplyWithImage(file, caption);
    } catch (err) {
      toast.error(`Не удалось отправить пометки: ${(err as Error).message}`);
      setSendingReply(false);
    }
  };

  const handleAttachAnnotatedToDraft = async (): Promise<void> => {
    if (!attachment || !onAttachToDraft || !imageElementRef.current || sendingReply) return;
    setSendingReply(true);
    try {
      const file = await exportAnnotatedImageFile(
        imageElementRef.current,
        currentStrokes,
        attachment.filename,
      );
      onAttachToDraft(file);
      onClose();
    } catch (err) {
      toast.error(`Не удалось сохранить пометки: ${(err as Error).message}`);
      setSendingReply(false);
    }
  };

  if (!attachment)
    return (
      <DialogContent>
        <DialogTitle>Вложение недоступно</DialogTitle>
      </DialogContent>
    );

  const image = isImageFile(attachment.mimeType, attachment.filename);
  const mp4 = isMp4File(attachment.mimeType, attachment.filename);
  const docx = !image && !mp4 && isDocxFile(attachment.mimeType, attachment.filename);
  // Видео, документ и активное рисование пальцем обрабатывают жесты сами.
  const ownGestures = zoomed || mp4 || docx || (image && (touchDrawArmed || hasStrokes));
  const showAnnotationTools = image && !zoomed && Boolean(onReplyWithImage || onAttachToDraft);

  return (
    <DialogContent
      hideClose
      mobileSheet={false}
      overlayClassName="bg-black/82 backdrop-blur-md"
      aria-describedby={undefined}
      className="pf-gallery fixed inset-0 z-50 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col justify-between gap-2 overflow-hidden rounded-none bg-transparent p-2 text-white shadow-none sm:inset-0 sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:p-4"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && hasStrokes) {
          event.preventDefault();
          event.stopPropagation();
          undoStroke();
          return;
        }
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
      {/* Верхняя панель вне картинки: полупрозрачная капсула с названием и кнопки действий */}
      <header className="pointer-events-none z-20 flex shrink-0 items-center justify-between gap-2">
        <div className="pointer-events-auto flex min-w-0 max-w-[60vw] items-center gap-2 rounded-full bg-black/55 px-3.5 py-2 backdrop-blur-md">
          <DialogTitle
            className="truncate text-xs font-medium leading-4 text-white/95 sm:text-sm"
            title={attachment.filename}
          >
            {attachment.filename}
          </DialogTitle>
          {attachment.sizeBytes > 0 && (
            <span className="hidden shrink-0 text-2xs text-white/65 tabular-nums sm:inline">
              {formatBytes(attachment.sizeBytes)}
            </span>
          )}
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
          {image && (
            <button
              type="button"
              className={FLOATING_ICON_BTN}
              aria-pressed={zoomed}
              onClick={() => setZoomed((value) => !value)}
              aria-label={
                zoomed ? 'Уменьшить изображение' : 'Увеличить изображение'
              }
              title={zoomed ? 'Уменьшить' : 'Увеличить'}
            >
              {zoomed ? (
                <ZoomOut className="size-5" />
              ) : (
                <ZoomIn className="size-5" />
              )}
            </button>
          )}
          <a
            href={attachment.url}
            download={attachment.filename}
            className={FLOATING_ICON_BTN}
            aria-label="Скачать вложение"
            title="Скачать"
          >
            <Download className="size-5" />
          </a>
          <button
            type="button"
            className={FLOATING_ICON_BTN}
            onClick={onClose}
            aria-label="Закрыть просмотр"
            title="Закрыть (Esc)"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>

      {/* Центральная сцена без рамок — картинка раскрывается почти на весь экран */}
      <div
        className="pf-gallery-stage"
        data-pf-no-swipe
        data-pf-no-edge-swipe
        data-kind={docx ? 'document' : undefined}
        style={{ touchAction: ownGestures ? 'auto' : 'pan-y pinch-zoom' }}
        onClick={(event) => {
          // Клик по свободному тёмному фону вокруг картинки закрывает лайтбокс.
          const target = event.target as HTMLElement;
          if (
            target.classList.contains('pf-gallery-stage') ||
            target.classList.contains('pf-gallery-image') ||
            target.classList.contains('pf-gallery-image-canvas')
          ) {
            onClose();
          }
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          swipe.current =
            !ownGestures && event.touches.length === 1 && touch
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
            canDraw={showAnnotationTools}
            touchDrawEnabled={touchDrawArmed || items.length === 1 || hasStrokes}
            tool={tool}
            color={color}
            strokes={currentStrokes}
            onAddStroke={pushStroke}
            imageRef={imageElementRef}
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
        ) : docx ? (
          <DocxPreview key={attachment.id} attachment={attachment} />
        ) : (
          <div className="grid h-full place-content-center justify-items-center gap-3 px-6 text-center">
            <FileText className="size-12 text-white/70" />
            <p className="text-sm text-white/80">
              Предпросмотр недоступен. Скачайте файл, чтобы открыть его.
            </p>
          </div>
        )}
      </div>

      {/* Нижний плавающий док: инструменты быстрой разметки на картинке, ответ в 1 клик и навигация */}
      <footer className="pointer-events-none z-20 flex shrink-0 flex-col items-center gap-2">
        {/* Полоса мгновенной отправки помеченной картинки в чат ответом (появляется сразу после первого штриха) */}
        {showAnnotationTools && hasStrokes && (
          <div
            data-pf-annotation-reply-bar
            className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-full bg-black/75 p-1.5 backdrop-blur-md"
          >
            <button
              type="button"
              onClick={undoStroke}
              aria-label="Отменить последний штрих"
              title="Отменить штрих (Ctrl+Z)"
              className={FLOATING_ICON_BTN}
            >
              <Undo2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={clearStrokes}
              aria-label="Очистить пометки"
              title="Очистить все пометки"
              className={FLOATING_ICON_BTN}
            >
              <Trash2 className="size-4" />
            </button>

            {onReplyWithImage && (
              <input
                type="text"
                value={replyCaption}
                onChange={(e) => setReplyCaption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendAnnotatedReply();
                  }
                }}
                placeholder={
                  replyAuthorName
                    ? `Ответить ${replyAuthorName}…`
                    : 'Комментарий к пометкам…'
                }
                aria-label="Текст ответа к помеченной картинке"
                className="h-11 w-44 min-w-0 rounded-full bg-white/12 px-3.5 text-xs text-white placeholder:text-white/55 focus:bg-white/18 focus:outline-none sm:w-56"
              />
            )}

            {onAttachToDraft && (
              <button
                type="button"
                disabled={sendingReply}
                onClick={() => void handleAttachAnnotatedToDraft()}
                aria-label={attachActionLabel ?? 'В черновик ответа'}
                title={
                  onReplyWithImage
                    ? 'Прикрепить изменённую картинку в поле комментария, не отправляя сразу'
                    : (attachActionLabel ?? 'Сохранить пометки')
                }
                className={cn(
                  'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors',
                  onReplyWithImage
                    ? 'bg-white/15 text-white hover:bg-white/25'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                <CornerDownRight className="size-4 shrink-0" />
                <span>{attachActionLabel ?? 'В черновик'}</span>
              </button>
            )}

            {onReplyWithImage && (
              <button
                type="button"
                disabled={sendingReply}
                onClick={() => void handleSendAnnotatedReply()}
                aria-label="Отправить ответом в чат"
                title="Одним нажатием отправить помеченную картинку ответом в чат"
                className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {sendingReply ? (
                  <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" />
                ) : (
                  <Send className="size-4 shrink-0" />
                )}
                <span>Отправить ответом</span>
              </button>
            )}
          </div>
        )}

        {/* Основной компактный полупрозрачный док: листание + выбор инструмента и цвета маркера */}
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full bg-black/60 px-2 py-1 backdrop-blur-md">
          <button
            type="button"
            className={FLOATING_ICON_BTN}
            disabled={index === 0}
            onClick={() => select(index - 1)}
            aria-label="Предыдущее вложение"
          >
            <ChevronLeft className="size-5" />
          </button>
          <span
            className="min-w-10 px-1 text-center text-xs tabular-nums text-white/80"
            aria-live="polite"
            aria-atomic="true"
          >
            {index + 1} / {items.length}
          </span>
          <button
            type="button"
            className={FLOATING_ICON_BTN}
            disabled={index === items.length - 1}
            onClick={() => select(index + 1)}
            aria-label="Следующее вложение"
          >
            <ChevronRight className="size-5" />
          </button>

          {showAnnotationTools && (
            <>
              <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-white/15 sm:inline-block" />
              <button
                type="button"
                aria-label="Маркер"
                aria-pressed={tool === 'pen'}
                title="Рисовать маркером по картинке"
                onClick={() => {
                  setTool('pen');
                  setTouchDrawArmed(true);
                }}
                className={cn(
                  FLOATING_ICON_BTN,
                  tool === 'pen' && 'bg-white/25 text-white ring-1 ring-white/40',
                )}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Стрелка"
                aria-pressed={tool === 'arrow'}
                title="Нарисовать стрелку"
                onClick={() => {
                  setTool('arrow');
                  setTouchDrawArmed(true);
                }}
                className={cn(
                  FLOATING_ICON_BTN,
                  tool === 'arrow' && 'bg-white/25 text-white ring-1 ring-white/40',
                )}
              >
                <MoveUpRight className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Рамка"
                aria-pressed={tool === 'rect'}
                title="Выделить область рамкой"
                onClick={() => {
                  setTool('rect');
                  setTouchDrawArmed(true);
                }}
                className={cn(
                  FLOATING_ICON_BTN,
                  tool === 'rect' && 'bg-white/25 text-white ring-1 ring-white/40',
                )}
              >
                <Square className="size-4" />
              </button>

              {ANNOTATION_COLORS.map((c) => {
                const active = color === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    aria-label={c.label}
                    aria-pressed={active}
                    title={c.label}
                    onClick={() => {
                      setColor(c.value);
                      setTouchDrawArmed(true);
                    }}
                    className="grid size-11 shrink-0 place-items-center rounded-full transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span
                      className={cn(
                        'size-5 rounded-full transition-transform',
                        active
                          ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-black/70'
                          : 'opacity-80 hover:opacity-100',
                      )}
                      style={{ backgroundColor: c.value }}
                    />
                  </button>
                );
              })}
            </>
          )}
        </div>
      </footer>
    </DialogContent>
  );
}

function GalleryImage({
  attachment,
  zoomed,
  onToggleZoom,
  canDraw,
  touchDrawEnabled,
  tool,
  color,
  strokes,
  onAddStroke,
  imageRef,
}: {
  attachment: TaskAttachment;
  zoomed: boolean;
  onToggleZoom: () => void;
  canDraw: boolean;
  touchDrawEnabled: boolean;
  tool: DrawTool;
  color: string;
  strokes: readonly DrawStroke[];
  onAddStroke: (stroke: DrawStroke) => void;
  imageRef: React.MutableRefObject<HTMLImageElement | null>;
}): React.ReactElement {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draftStroke, setDraftStroke] = useState<DrawStroke | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerIdRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (node) {
      node.scrollLeft = zoomed ? (node.scrollWidth - node.clientWidth) / 2 : 0;
      node.scrollTop = zoomed ? (node.scrollHeight - node.clientHeight) / 2 : 0;
    }
  }, [zoomed]);

  const redrawCanvas = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const targetW = Math.max(1, Math.round(rect.width * dpr));
    const targetH = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const all = draftStroke ? [...strokes, draftStroke] : strokes;
    renderAnnotationStrokes(ctx, all, targetW, targetH);
  }, [strokes, draftStroke]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas, loaded, zoomed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => redrawCanvas());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redrawCanvas]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): NormalizedPoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
    const y = rect.height > 0 ? Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) : 0;
    return { x, y };
  };

  return (
    <div ref={viewport} className="pf-gallery-image" data-zoomed={zoomed}>
      {!loaded && !failed && (
        <Skeleton
          className="absolute inset-6 rounded-2xl bg-white/10"
          aria-label="Загрузка изображения"
        />
      )}
      {failed ? (
        <div
          role="status"
          className="grid h-full place-content-center justify-items-center gap-3 px-4 text-center"
        >
          <ImageOff className="size-8 text-white/60" />
          <p className="text-sm text-white/90">Не удалось загрузить изображение</p>
          <Button
            variant="outline"
            className="min-h-11 min-w-11 bg-black/50 text-white hover:bg-black/70"
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
          className="pf-gallery-image-canvas flex items-center justify-center"
          style={{
            width: zoomed ? '200%' : '100%',
            height: zoomed ? '200%' : '100%',
          }}
        >
          <div className="relative inline-flex max-h-full max-w-full items-center justify-center">
            <img
              ref={imageRef}
              key={attempt}
              src={attachment.url}
              alt={attachment.filename}
              draggable={false}
              className="block max-h-[calc(100dvh-9.5rem)] max-w-[94vw] select-none object-contain"
              style={{
                opacity: loaded ? 1 : 0,
                cursor: zoomed ? 'zoom-out' : canDraw ? 'crosshair' : 'zoom-in',
              }}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              onDoubleClick={onToggleZoom}
            />
            {loaded && (
              <canvas
                ref={canvasRef}
                data-pf-annotation-canvas
                onDoubleClick={onToggleZoom}
                onPointerDown={(e) => {
                  if (!canDraw || e.button !== 0) return;
                  if (e.pointerType === 'touch' && !touchDrawEnabled) return;
                  e.preventDefault();
                  e.stopPropagation();
                  activePointerIdRef.current = e.pointerId;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    /* Synthetic events in unit tests may not register an active pointer id */
                  }
                  const pt = pointFromEvent(e);
                  setDraftStroke({
                    tool,
                    color,
                    points: [pt],
                  });
                }}
                onPointerMove={(e) => {
                  if (activePointerIdRef.current !== e.pointerId || !draftStroke) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const pt = pointFromEvent(e);
                  setDraftStroke((prev) => {
                    if (!prev) return null;
                    if (prev.tool === 'arrow' || prev.tool === 'rect') {
                      return { ...prev, points: [prev.points[0]!, pt] };
                    }
                    return { ...prev, points: [...prev.points, pt] };
                  });
                }}
                onPointerUp={(e) => {
                  if (activePointerIdRef.current !== e.pointerId) return;
                  activePointerIdRef.current = null;
                  if (draftStroke && draftStroke.points.length > 0) {
                    onAddStroke(draftStroke);
                  }
                  setDraftStroke(null);
                }}
                onPointerCancel={(e) => {
                  if (activePointerIdRef.current !== e.pointerId) return;
                  activePointerIdRef.current = null;
                  setDraftStroke(null);
                }}
                className={cn(
                  'absolute inset-0 size-full',
                  canDraw ? 'cursor-crosshair' : 'pointer-events-none',
                  canDraw && touchDrawEnabled && 'touch-none',
                )}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
