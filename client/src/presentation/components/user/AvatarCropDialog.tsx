import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

// Квадратное окно кадрирования (display) и размер экспорта (square).
const VIEWPORT = 256;
const OUTPUT = 512;

type Phase = 'crop' | 'saving' | 'done';

// Кадрирование аватара: зум (ползунок) + перетаскивание (выбор области), картинка всегда
// покрывает квадрат (без полей). На «Сохранить» рисуем выбранную область в canvas и отдаём
// webp-blob наверх. onConfirm возвращает Promise — пока грузится, показываем спиннер; после
// успеха — плавная галочка «Готово».
export function AvatarCropDialog({
  file,
  onConfirm,
  onClose,
}: {
  file: File;
  onConfirm: (blob: Blob) => Promise<void>;
  onClose: () => void;
}): React.ReactElement {
  const { animations } = useMotion();
  const [url] = useState(() => URL.createObjectURL(file));
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('crop');
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const baseScale = nat ? Math.max(VIEWPORT / nat.w, VIEWPORT / nat.h) : 1;
  const scale = baseScale * zoom;
  const sw = nat ? nat.w * scale : 0;
  const sh = nat ? nat.h * scale : 0;

  const clampOffset = (x: number, y: number, w: number, h: number): { x: number; y: number } => ({
    x: Math.min(0, Math.max(VIEWPORT - w, x)),
    y: Math.min(0, Math.max(VIEWPORT - h, y)),
  });

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNat({ w, h });
    const s = Math.max(VIEWPORT / w, VIEWPORT / h);
    setOffset({ x: (VIEWPORT - w * s) / 2, y: (VIEWPORT - h * s) / 2 });
  };

  const handleZoom = (next: number): void => {
    if (!nat) {
      setZoom(next);
      return;
    }
    const oldScale = baseScale * zoom;
    const newScale = baseScale * next;
    // Якорим центр вьюпорта: точка под центром остаётся на месте при зуме.
    const cx = (VIEWPORT / 2 - offset.x) / oldScale;
    const cy = (VIEWPORT / 2 - offset.y) / oldScale;
    const nx = VIEWPORT / 2 - cx * newScale;
    const ny = VIEWPORT / 2 - cy * newScale;
    setZoom(next);
    setOffset(clampOffset(nx, ny, nat.w * newScale, nat.h * newScale));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (phase !== 'crop') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    setOffset(clampOffset(drag.current.ox + dx, drag.current.oy + dy, sw, sh));
  };
  const onPointerUp = (): void => {
    drag.current = null;
    setDragging(false);
  };

  const makeBlob = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      if (!nat || !imgRef.current) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      const sx = -offset.x / scale;
      const sy = -offset.y / scale;
      const sSize = VIEWPORT / scale;
      ctx.drawImage(imgRef.current, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else canvas.toBlob((png) => resolve(png), 'image/png');
        },
        'image/webp',
        0.9,
      );
    });

  const handleSave = async (): Promise<void> => {
    const blob = await makeBlob();
    if (!blob) return;
    setPhase('saving');
    try {
      await onConfirm(blob);
      setPhase('done');
      window.setTimeout(onClose, 1100); // даём доиграть галочке
    } catch {
      setPhase('crop'); // ошибку покажет родитель тостом
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && phase !== 'saving' && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Настройте аватар</DialogTitle>
          <DialogDescription>
            Перетащите фото (влево-вправо, вверх-вниз) и приблизьте ползунком — что в квадрате,
            то и будет аватаром.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait" initial={false}>
          {phase === 'done' ? (
            <motion.div
              key="done"
              initial={animations ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center gap-3 py-8"
            >
              <motion.div
                initial={animations ? { scale: 0 } : false}
                animate={{ scale: 1 }}
                transition={animations ? { type: 'spring', stiffness: 360, damping: 16 } : { duration: 0 }}
                className="grid size-16 place-items-center rounded-full bg-success/15 text-success"
              >
                <motion.span
                  initial={animations ? { scale: 0, rotate: -25 } : false}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={
                    animations
                      ? { delay: 0.1, type: 'spring', stiffness: 520, damping: 15 }
                      : { duration: 0 }
                  }
                >
                  <Check className="size-8" strokeWidth={3} />
                </motion.span>
              </motion.div>
              <motion.p
                initial={animations ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={animations ? { delay: 0.18 } : { duration: 0 }}
                className="text-sm font-medium"
              >
                Готово!
              </motion.p>
            </motion.div>
          ) : (
            <motion.div
              key="crop"
              initial={animations ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4"
            >
              <div
                className="relative touch-none select-none overflow-hidden rounded-[25%] bg-muted shadow-inner"
                style={{ width: VIEWPORT, height: VIEWPORT }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <img
                  ref={imgRef}
                  src={url}
                  alt=""
                  draggable={false}
                  onLoad={handleImgLoad}
                  className={cn(
                    'pointer-events-none absolute max-w-none origin-top-left',
                    dragging ? 'cursor-grabbing' : 'cursor-grab',
                    !dragging && animations && 'transition-[width,height,left,top] duration-200 ease-out',
                  )}
                  style={{ left: offset.x, top: offset.y, width: sw, height: sh }}
                />
                {/* Лёгкая рамка-подсказка области */}
                <div className="pointer-events-none absolute inset-0 rounded-[25%] ring-1 ring-inset ring-black/10 dark:ring-white/15" />
              </div>

              <div className="flex w-full items-center gap-3">
                <button
                  type="button"
                  aria-label="Отдалить"
                  onClick={() => handleZoom(Math.max(1, Number((zoom - 0.2).toFixed(2))))}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ZoomOut className="size-4" />
                </button>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => handleZoom(Number(e.target.value))}
                  aria-label="Масштаб"
                  className="h-1 w-full cursor-pointer accent-primary"
                />
                <button
                  type="button"
                  aria-label="Приблизить"
                  onClick={() => handleZoom(Math.min(3, Number((zoom + 0.2).toFixed(2))))}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ZoomIn className="size-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {phase !== 'done' && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={phase === 'saving'}>
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={phase === 'saving' || !nat}
              className="transition-transform active:scale-95"
            >
              {phase === 'saving' ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Сохраняем…
                </>
              ) : (
                'Сохранить'
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
