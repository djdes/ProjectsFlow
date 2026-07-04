import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Download, ImageIcon, MoveVertical, Smile, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { IconPicker } from '@/presentation/components/project/IconPicker';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { ProjectCoverPicker } from '@/presentation/components/project/ProjectCoverPicker';
import {
  coverStyle,
  isGradientCover,
  randomCover,
} from '@/presentation/components/project/coverGallery';

// Патч медиа-полей задачи. undefined = не менять; null (для icon/cover) = очистить.
export type TaskMediaPatch = {
  icon?: string | null;
  cover?: string | null;
  coverPosition?: number;
};

type Props = {
  // Ключ задачи — при смене пересеиваем локальное состояние (окно переиспользуется при пред/след).
  taskId: string;
  icon: string | null;
  cover: string | null;
  coverPosition: number;
  canEdit: boolean;
  // Сохранить изменения (оптимистично отражаются локально сразу же).
  onSave: (patch: TaskMediaPatch) => void;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Загруженный файл → data-URL (клиентский ресайз без бэкенда): вписываем в макс. 1600px,
// кодируем в webp. Хранится прямо в строковом поле `cover` (как и иконка — в `icon`).
async function fileToCoverDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas недоступен');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/webp', 0.85);
}

// Обложка + иконка задачи в окне (Notion-style), зеркало шапки проекта (ProjectCover +
// ProjectIconPicker), но данные лежат прямо на задаче (icon/cover/coverPosition, db/093–094):
// градиент-пресет `gradient:<id>` или data-URL картинки. Локальное состояние оптимистично —
// правка видна мгновенно, ещё до ответа сервера.
export function TaskHeaderMedia({
  taskId,
  icon,
  cover,
  coverPosition,
  canEdit,
  onSave,
}: Props): React.ReactElement {
  // Оптимистичные локальные значения (окно показывает `task` из пропсов, который не
  // рефетчится синхронно). Пересеиваем при смене задачи.
  const [localIcon, setLocalIcon] = useState<string | null>(icon);
  const [localCover, setLocalCover] = useState<string | null>(cover);
  const [localPos, setLocalPos] = useState<number>(coverPosition);
  useEffect(() => {
    setLocalIcon(icon);
    setLocalCover(cover);
    setLocalPos(coverPosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [repositioning, setRepositioning] = useState(false);
  const [tempPos, setTempPos] = useState(coverPosition);
  const [uploading, setUploading] = useState(false);
  const drag = useRef<{ startY: number; startPos: number } | null>(null);

  const isGradient = isGradientCover(localCover);

  const setIcon = (next: string | null): void => {
    setLocalIcon(next);
    onSave({ icon: next });
  };

  const setCover = (url: string): void => {
    setLocalCover(url);
    onSave({ cover: url });
  };

  const addRandomCover = (): void => {
    setCover(randomCover());
  };

  const removeCover = (): void => {
    setLocalCover(null);
    setRepositioning(false);
    onSave({ cover: null, coverPosition: 50 });
    setLocalPos(50);
  };

  const uploadFile = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      toast.error('Можно вставить только изображение');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToCoverDataUrl(file);
      setCover(dataUrl);
      setPickerOpen(false);
    } catch (e) {
      toast.error(`Не удалось загрузить обложку: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const startReposition = (): void => {
    setTempPos(localPos);
    setRepositioning(true);
  };
  const saveReposition = (): void => {
    const rounded = Math.round(tempPos);
    setRepositioning(false);
    if (rounded !== localPos) {
      setLocalPos(rounded);
      onSave({ coverPosition: rounded });
    }
  };
  const cancelReposition = (): void => {
    setTempPos(localPos);
    setRepositioning(false);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!repositioning) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startPos: tempPos };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    const h = e.currentTarget.clientHeight || 160;
    setTempPos(clamp(drag.current.startPos - (dy / h) * 100, 0, 100));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const download = async (): Promise<void> => {
    if (!localCover || isGradient) {
      toast.info('Градиентную обложку нельзя скачать файлом — загрузите своё фото');
      return;
    }
    try {
      const res = await fetch(localCover);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `task-cover-${taskId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(localCover, '_blank', 'noopener');
    }
  };

  const activePos = repositioning ? tempPos : localPos;

  return (
    <div>
      {/* === ОБЛОЖКА === Во всю ширину над иконкой/заголовком (если задана). */}
      {localCover && (
        <div className="group/cover relative w-full overflow-hidden">
          <div
            style={coverStyle(localCover, activePos)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={cn(
              'h-32 w-full bg-muted sm:h-40',
              repositioning && !isGradient && 'cursor-grab touch-none active:cursor-grabbing',
            )}
          />
          {canEdit && !repositioning && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-2.5">
              <div className="pointer-events-auto flex items-center gap-1.5 opacity-0 transition-opacity group-hover/cover:opacity-100">
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <CoverButton>
                      <ImageIcon className="size-3.5" />
                      Поменять
                    </CoverButton>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-auto overflow-hidden p-0"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    <ProjectCoverPicker
                      onSetCover={setCover}
                      onUploadFile={(f) => void uploadFile(f)}
                      onRemove={removeCover}
                      onClose={() => setPickerOpen(false)}
                      busy={uploading}
                      uploading={uploading}
                      uploadPct={0}
                    />
                  </PopoverContent>
                </Popover>
                <CoverButton onClick={startReposition} disabled={isGradient} aria-label="Переместить">
                  <MoveVertical className="size-3.5" />
                  Переместить
                </CoverButton>
                <CoverButton onClick={() => void download()} aria-label="Скачать">
                  <Download className="size-3.5" />
                </CoverButton>
              </div>
            </div>
          )}
          {repositioning && (
            <>
              {!isGradient && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="rounded-md bg-black/60 px-2.5 py-1 text-xs font-medium text-white shadow-sm">
                    Перетащите изображение, чтобы изменить положение
                  </span>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-2.5">
                <CoverButton onClick={saveReposition}>
                  <Check className="size-3.5" />
                  Сохранить положение
                </CoverButton>
                <CoverButton onClick={cancelReposition}>
                  <X className="size-3.5" />
                  Отмена
                </CoverButton>
              </div>
            </>
          )}
        </div>
      )}

      {/* === ИКОНКА + КНОПКИ «ДОБАВИТЬ» === Иконка (если задана) — крупный квадрат слева над
          заголовком; при наличии обложки чуть наезжает на неё снизу (Notion-style). Ряд кнопок
          «Добавить иконку / Добавить обложку» виден на hover шапки (на тач — всегда). */}
      <div className="group/head px-4">
        {localIcon && (
          <div className={cn('flex', localCover ? '-mt-7 sm:-mt-8' : 'pt-1')}>
            <IconPicker
              value={localIcon}
              onChange={setIcon}
              trigger={
                <button
                  type="button"
                  aria-label="Сменить иконку"
                  title="Иконка"
                  className={cn(
                    'grid shrink-0 cursor-pointer select-none place-items-center overflow-hidden rounded-lg leading-none transition-colors hover:bg-muted',
                    'size-14 sm:size-16',
                    localCover && 'bg-background shadow-sm ring-1 ring-border',
                  )}
                >
                  <ProjectIconView icon={localIcon} pixelSize={40} className="text-[2.2rem]" />
                </button>
              }
            />
          </div>
        )}

        {canEdit && (
          <div
            className={cn(
              'flex h-8 items-center gap-1 transition-opacity duration-150',
              'opacity-100 sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover/head:opacity-100',
              localIcon ? 'mt-1' : 'pt-1',
            )}
          >
            {!localIcon && (
              <IconPicker
                value={null}
                onChange={setIcon}
                trigger={
                  <HeadToolButton>
                    <Smile className="size-4" />
                    Добавить иконку
                  </HeadToolButton>
                }
              />
            )}
            {!localCover && (
              <HeadToolButton onClick={addRandomCover}>
                <ImageIcon className="size-4" />
                Добавить обложку
              </HeadToolButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Полупрозрачная тёмная «пилюля» поверх обложки (читается на любом фоне).
function CoverButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactElement {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-black/55 px-2.5 py-1 text-xs font-medium text-white shadow-sm backdrop-blur-sm transition-colors',
        'hover:bg-black/70 disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// Лёгкая текстовая кнопка ряда «Добавить …» (совпадает по стилю с шапкой проекта).
const HeadToolButton = ({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactElement => (
  <button
    type="button"
    className={cn(
      'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
      className,
    )}
    {...props}
  >
    {children}
  </button>
);
