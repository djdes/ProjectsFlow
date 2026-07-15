import { Download, FileText, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { formatBytes, isImageFile, isMp4File } from './files';

// Превью вложения с увеличением. Картинки — полноразмерный <img>, MP4 — видеоплеер,
// остальные файлы — иконка + кнопка скачать.
export function AttachmentLightbox({
  attachment,
  onClose,
}: {
  attachment: TaskAttachment | null;
  onClose: () => void;
}): React.ReactElement {
  const image = attachment ? isImageFile(attachment.mimeType, attachment.filename) : false;
  const mp4 = attachment ? isMp4File(attachment.mimeType, attachment.filename) : false;
  return (
    <Dialog open={attachment !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid max-h-[90dvh] max-w-4xl gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="truncate text-sm font-medium">{attachment?.filename ?? ''}</p>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Закрыть">
            <X className="size-4" />
          </Button>
        </div>
        {/* Клик по тёмной области вокруг картинки закрывает превью (как крестик). Клик по самой
            картинке/карточке файла — НЕ закрывает (stopPropagation), чтобы можно было рассмотреть. */}
        <div
          className="grid cursor-zoom-out place-items-center overflow-auto bg-muted/30 p-2 sm:p-4"
          onClick={onClose}
        >
          {attachment && image ? (
            <img
              src={attachment.url}
              alt={attachment.filename}
              className="max-h-[75dvh] max-w-full cursor-default object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : attachment && mp4 ? (
            <video
              src={attachment.url}
              controls
              playsInline
              preload="metadata"
              className="max-h-[72dvh] max-w-full cursor-default rounded bg-black"
              aria-label={`Видео ${attachment.filename}`}
              onClick={(e) => e.stopPropagation()}
            >
              Ваш браузер не поддерживает просмотр MP4.
            </video>
          ) : attachment ? (
            <div
              className="flex cursor-default flex-col items-center gap-3 py-10 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <FileText className="size-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{formatBytes(attachment.sizeBytes)}</p>
              <Button asChild variant="outline" size="sm">
                <a href={attachment.url} download={attachment.filename}>
                  <Download className="size-4" />
                  Скачать
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
