import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ImageIcon, MoveVertical, Download, Check, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { ProjectCoverPicker } from './ProjectCoverPicker';
import { coverStyle, isGradientCover } from './coverGallery';

type Props = {
  projectId: string;
  coverUrl: string;
  coverPosition: number;
  canEdit: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Обложка проекта (Notion-style): фон во всю ширину над заголовком. При наведении (и наличии
// прав) — панель управления: «Поменять» (поповер с галереей/загрузкой/ссылкой), «Переместить»
// (вертикальный drag позиции), «Скачать». Позиция/URL хранятся на проекте, refresh — через
// общий список проектов (applyReplace).
export function ProjectCover({ projectId, coverUrl, coverPosition, canEdit }: Props): React.ReactElement {
  const { submit, saving } = useUpdateProject();
  const { projectRepository } = useContainer();
  const { applyReplace } = useProjectsContext();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [repositioning, setRepositioning] = useState(false);
  const [tempPos, setTempPos] = useState(coverPosition);
  const [uploading, setUploading] = useState(false);
  // Прогресс аплоада 0..100 — для мгновенного прогресс-бара в поповере (файл или ctrl+v).
  const [uploadPct, setUploadPct] = useState(0);
  const drag = useRef<{ startY: number; startPos: number } | null>(null);

  const isGradient = isGradientCover(coverUrl);
  const busy = saving || uploading;

  const setCover = (url: string): void => {
    void submit(projectId, { coverUrl: url }).catch((e) =>
      toast.error(`Не удалось сменить обложку: ${(e as Error).message}`),
    );
  };

  const uploadFile = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      toast.error('Можно вставить только изображение');
      return;
    }
    // Показываем прогресс-бар моментально (0 %), ещё до первого события аплоада.
    setUploadPct(0);
    setUploading(true);
    try {
      const next = await projectRepository.uploadCover(projectId, file, setUploadPct);
      applyReplace(next);
      setPickerOpen(false);
    } catch (e) {
      toast.error(`Не удалось загрузить обложку: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  };

  const removeCover = (): void => {
    void submit(projectId, { coverUrl: null, coverPosition: 50 }).catch((e) =>
      toast.error(`Не удалось убрать обложку: ${(e as Error).message}`),
    );
  };

  const startReposition = (): void => {
    setTempPos(coverPosition);
    setRepositioning(true);
  };

  const saveReposition = (): void => {
    const rounded = Math.round(tempPos);
    setRepositioning(false);
    if (rounded !== coverPosition) {
      void submit(projectId, { coverPosition: rounded }).catch((e) =>
        toast.error(`Не удалось сохранить положение: ${(e as Error).message}`),
      );
    }
  };

  const cancelReposition = (): void => {
    setTempPos(coverPosition);
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
    const h = e.currentTarget.clientHeight || 200;
    // Тянем изображение вниз → показываем больше верхней части → позиция уменьшается.
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
    // Градиент — это CSS, а не файл: скачивать нечего.
    if (isGradient) {
      toast.info('Градиентную обложку нельзя скачать файлом — загрузите своё фото');
      return;
    }
    try {
      const res = await fetch(coverUrl, { credentials: 'include' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cover-${projectId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(coverUrl, '_blank', 'noopener');
    }
  };

  const activePos = repositioning ? tempPos : coverPosition;

  return (
    <div className="group/cover relative w-full overflow-hidden">
      <div
        style={coverStyle(coverUrl, activePos)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          'h-40 w-full bg-muted sm:h-52',
          repositioning && !isGradient && 'cursor-grab touch-none active:cursor-grabbing',
        )}
      />

      {/* Панель управления — в правом ВЕРХНЕМ углу обложки (как в Notion). Видна сразу, как
          только есть обложка (без наведения) — 3 кнопки: Поменять / Переместить / Скачать. */}
      {canEdit && !repositioning && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3">
          <div className="pointer-events-auto flex items-center gap-1.5">
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
                  busy={busy}
                  uploading={uploading}
                  uploadPct={uploadPct}
                />
              </PopoverContent>
            </Popover>
            {/* Переместить: реально двигает только фото (у градиента позиция не важна). */}
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

      {/* Режим перемещения: подсказка + Сохранить/Отмена */}
      {repositioning && (
        <>
          {!isGradient && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="rounded-md bg-black/60 px-2.5 py-1 text-xs font-medium text-white shadow-sm">
                Перетащите изображение, чтобы изменить положение
              </span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-3">
            <CoverButton onClick={saveReposition} disabled={busy}>
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
