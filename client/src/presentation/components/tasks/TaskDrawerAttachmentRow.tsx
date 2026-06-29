import { useState, useRef } from 'react';
import { FileText, Loader2, Paperclip, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import { formatBytes, isImageMime } from '@/presentation/components/attachments/files';

type Props = {
  items: readonly TaskAttachment[];
  // Если true — рендерим кнопку «+» для добавления файлов через picker и «×» для удаления.
  canEdit: boolean;
  onAddFiles?: (files: File[]) => void;
  // Удалить вложение. Если не передан — кнопки удаления нет.
  onDelete?: (att: TaskAttachment) => void;
};

export function TaskDrawerAttachmentRow({
  items,
  canEdit,
  onAddFiles,
  onDelete,
}: Props): React.ReactElement | null {
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  // id вложения, для которого идёт удаление (дизейблит кнопку + спиннер).
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  const handleDelete = (att: TaskAttachment): void => {
    if (!onDelete || deletingId) return;
    setDeletingId(att.id);
    // onDelete сам перефетчит список (att исчезнет) — локальный флаг чистим на случай ошибки.
    try {
      onDelete(att);
    } finally {
      // Сбрасываем чуть позже: список перерисуется и чип уйдёт; флаг — страховка.
      window.setTimeout(() => setDeletingId((cur) => (cur === att.id ? null : cur)), 1500);
    }
  };

  // С файлами: занимаем свою строку под чипами (basis-full в flex-wrap родителе).
  // Каждый чип: превью/иконка + имя файла + размер; клик по телу — лайтбокс/скачивание,
  // «×» (canEdit) — удаление.
  return (
    <div className="flex basis-full flex-wrap items-center gap-1.5 pt-1">
      {items.map((att) => {
        const deleting = deletingId === att.id;
        return (
          <span
            key={att.id}
            className={cn(
              'group/att inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background py-0.5 pl-1 pr-1 text-[11px] transition-opacity',
              deleting && 'opacity-50',
            )}
          >
            <button
              type="button"
              onClick={() => setPreview(att)}
              className="flex min-w-0 items-center gap-1.5"
              title={att.filename}
              aria-label={`Открыть ${att.filename}`}
            >
              {isImageMime(att.mimeType) && att.url ? (
                <img
                  src={att.url}
                  alt=""
                  loading="lazy"
                  className="size-5 shrink-0 rounded object-cover"
                />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="max-w-[160px] truncate">{att.filename}</span>
              <span className="shrink-0 text-muted-foreground/70">{formatBytes(att.sizeBytes)}</span>
            </button>
            {canEdit && onDelete && (
              <button
                type="button"
                disabled={deleting}
                onClick={() => handleDelete(att)}
                className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-white disabled:opacity-50"
                aria-label={`Удалить ${att.filename}`}
                title="Удалить файл"
              >
                {deleting ? (
                  <Loader2 className="size-2.5 animate-spin" />
                ) : (
                  <X className="size-2.5" />
                )}
              </button>
            )}
          </span>
        );
      })}

      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="grid size-7 shrink-0 place-items-center rounded-md border border-dashed text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
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
