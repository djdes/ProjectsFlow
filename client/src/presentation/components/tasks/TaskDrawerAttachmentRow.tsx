import { useState, useRef } from 'react';
import { FileText, Paperclip, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import { isImageMime } from '@/presentation/components/attachments/files';

type Props = {
  items: readonly TaskAttachment[];
  // Если true — рендерим кнопку «+» для добавления файлов через picker.
  canEdit: boolean;
  onAddFiles?: (files: File[]) => void;
};

export function TaskDrawerAttachmentRow({
  items,
  canEdit,
  onAddFiles,
}: Props): React.ReactElement | null {
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (items.length === 0 && !canEdit) return null;

  const fileInput = canEdit ? (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      className="hidden"
      onChange={(e) => {
        if (e.target.files && onAddFiles) {
          onAddFiles(Array.from(e.target.files));
        }
        e.target.value = '';
      }}
    />
  ) : null;

  // Без файлов: один тихий чип «Файл» в ряду свойств — никаких плейсхолдеров
  // «нет файлов» и пунктирных квадратов (визуальный шум для пустого состояния).
  if (items.length === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Прикрепить файл (или Ctrl+V в комментарий)"
        >
          <Paperclip className="size-3.5" />
          Файл
        </button>
        {fileInput}
      </>
    );
  }

  // С файлами: занимаем свою строку под чипами (basis-full в flex-wrap родителе).
  return (
    <div className="flex basis-full items-center gap-1.5 overflow-x-auto pb-0.5 pr-1 pt-1 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
      {items.map((att) => (
        <button
          key={att.id}
          type="button"
          onClick={() => setPreview(att)}
          className={cn(
            'group/att relative size-8 shrink-0 overflow-hidden rounded-md border bg-muted',
            'transition-transform hover:scale-105',
          )}
          aria-label={`Открыть ${att.filename}`}
          title={att.filename}
        >
          {isImageMime(att.mimeType) && att.url ? (
            <img src={att.url} alt={att.filename} loading="lazy" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center bg-muted">
              <FileText className="size-3.5 text-muted-foreground" />
            </div>
          )}
        </button>
      ))}

      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="grid size-8 shrink-0 place-items-center rounded-md border border-dashed text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            aria-label="Добавить файл"
            title="Добавить файл"
          >
            <Plus className="size-3.5" />
          </button>
          {fileInput}
        </>
      )}

      <AttachmentLightbox attachment={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
