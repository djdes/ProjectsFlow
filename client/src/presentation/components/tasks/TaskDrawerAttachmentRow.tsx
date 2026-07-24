import { useState, useRef } from 'react';
import { FileText, Loader2, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import { formatBytes, isImageFile } from '@/presentation/components/attachments/files';

// Локальный файл, ещё не загруженный на сервер (create-mode): тот же чип, что и у
// загруженного вложения, но без url/размера и с «убрать» вместо «удалить».
export type PendingChip = { id: string; name: string; previewUrl: string };
// Активная загрузка — прогресс-бар прямо в строке (видно, что грузится и сколько осталось).
export type UploadChip = { id: string; name: string; progress: number; etaSec: number | null };

function etaText(sec: number | null): string {
  if (sec === null) return '';
  if (sec <= 0) return 'почти готово';
  if (sec < 60) return `~${sec} с`;
  return `~${Math.ceil(sec / 60)} мин`;
}

type Props = {
  items: readonly TaskAttachment[];
  // Если true — рендерим кнопку «+» для добавления файлов через picker и «×» для удаления.
  canEdit: boolean;
  onAddFiles?: (files: File[]) => void;
  // Удалить загруженное вложение. Если не передан — кнопки удаления нет.
  onDelete?: (att: TaskAttachment) => void;
  // Локальные (ещё не загруженные) файлы — create-mode.
  pending?: readonly PendingChip[];
  onRemovePending?: (id: string) => void;
  // Активные загрузки — прогресс-бары под чипами (create И edit).
  uploads?: readonly UploadChip[];
};

// Строка вложений в ряду свойств задачи. Единый вид в create и edit: чипы файлов
// (загруженных + ожидающих) + кнопка «+» для добавления прямо из строки + прогресс-бары
// активных загрузок. Пустое состояние — тихий чип «+ Файл».
export function TaskDrawerAttachmentRow({
  items,
  canEdit,
  onAddFiles,
  onDelete,
  pending = [],
  onRemovePending,
  uploads = [],
}: Props): React.ReactElement | null {
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  // id вложения, для которого идёт удаление (дизейблит кнопку + спиннер).
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasAny = items.length > 0 || pending.length > 0 || uploads.length > 0;
  if (!hasAny && !canEdit) return null;

  const fileInput = canEdit ? (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      className="hidden"
      onChange={(e) => {
        if (e.target.files && onAddFiles) onAddFiles(Array.from(e.target.files));
        e.target.value = '';
      }}
    />
  ) : null;

  // Пусто (ни файлов, ни загрузок): тихий плейсхолдер «Выбрать…» без иконки —
  // в один стиль с пикерами дедлайна/приоритета в ряду свойств.
  if (!hasAny) {
    return (
      <>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="-ml-1.5 inline-flex h-7 items-center rounded-md px-1.5 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          title="Прикрепить файл (или Ctrl+V в комментарий)"
        >
          Выбрать файл…
        </button>
        {fileInput}
      </>
    );
  }

  const handleDelete = (att: TaskAttachment): void => {
    if (!onDelete || deletingId) return;
    setDeletingId(att.id);
    try {
      onDelete(att);
    } finally {
      window.setTimeout(() => setDeletingId((cur) => (cur === att.id ? null : cur)), 1500);
    }
  };

  return (
    <div className="flex basis-full flex-col gap-1.5 pt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Загруженные вложения */}
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
                {isImageFile(att.mimeType, att.filename) && att.url ? (
                  <img src={att.url} alt="" loading="lazy" className="size-5 shrink-0 rounded object-cover" />
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
                  {deleting ? <Loader2 className="size-2.5 animate-spin" /> : <X className="size-2.5" />}
                </button>
              )}
            </span>
          );
        })}

        {/* Ожидающие (локальные) файлы — create-mode */}
        {pending.map((pf) => (
          <span
            key={pf.id}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background py-0.5 pl-1 pr-1 text-[11px]"
            title={pf.name}
          >
            {pf.previewUrl ? (
              <img src={pf.previewUrl} alt="" decoding="async" loading="lazy" className="size-5 shrink-0 rounded object-cover" />
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="max-w-[160px] truncate">{pf.name}</span>
            {onRemovePending && (
              <button
                type="button"
                onClick={() => onRemovePending(pf.id)}
                className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
                aria-label={`Убрать ${pf.name}`}
                title="Убрать файл"
              >
                <X className="size-2.5" />
              </button>
            )}
          </span>
        ))}

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
      </div>

      {/* Прогресс-бары активных загрузок — прямо в строке файлов. */}
      {uploads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-2">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="max-w-[140px] shrink-0 truncate text-[11px] text-muted-foreground">{u.name}</span>
              <Progress value={u.progress} className="h-1.5 min-w-0 flex-1" />
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{u.progress}%</span>
              {u.etaSec !== null && (
                <span className="shrink-0 text-[10px] text-muted-foreground/70">{etaText(u.etaSec)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <AttachmentLightbox attachment={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
