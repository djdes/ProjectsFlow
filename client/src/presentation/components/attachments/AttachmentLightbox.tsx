import { Download, FileText, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { formatBytes, isImageMime } from './files';

// Превью вложения с увеличением. Картинки — полноразмерный <img>; не-картинки —
// иконка + кнопка скачать (бинарь отдаётся сервером как attachment).
export function AttachmentLightbox({
  attachment,
  onClose,
}: {
  attachment: TaskAttachment | null;
  onClose: () => void;
}): React.ReactElement {
  const image = attachment ? isImageMime(attachment.mimeType) : false;
  return (
    <Dialog open={attachment !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid max-h-[90dvh] max-w-4xl gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="truncate text-sm font-medium">{attachment?.filename ?? ''}</p>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Закрыть">
            <X className="size-4" />
          </Button>
        </div>
        <div className="grid place-items-center overflow-auto bg-muted/30 p-2 sm:p-4">
          {attachment && image ? (
            <img
              src={attachment.url}
              alt={attachment.filename}
              className="max-h-[75dvh] max-w-full object-contain"
            />
          ) : attachment ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
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
