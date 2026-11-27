import {
  Download,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  Film,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import {
  formatBytes,
  isDocxFile,
  isImageFile,
  isMp4File,
} from '@/presentation/components/attachments/files';

export type FileKindMeta = {
  readonly ext: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly badgeClass: string;
};

const EXT_SETS = {
  pdf: new Set(['pdf']),
  doc: new Set(['doc', 'docx', 'rtf', 'odt', 'pages']),
  sheet: new Set(['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers']),
  archive: new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz']),
  video: new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v']),
  audio: new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']),
  code: new Set(['json', 'xml', 'yaml', 'yml', 'sql', 'md', 'txt', 'log', 'html', 'css', 'js', 'ts', 'tsx', 'py', 'sh']),
};

export function fileKindMeta(filename: string, mimeType?: string | null): FileKindMeta {
  const parts = filename.trim().split('.');
  const rawExt = parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : '';
  const ext = rawExt.slice(0, 6).toUpperCase() || 'ФАЙЛ';
  const mime = (mimeType ?? '').toLowerCase();

  if (EXT_SETS.pdf.has(rawExt) || mime === 'application/pdf') {
    return {
      ext: 'PDF',
      label: 'PDF-документ',
      Icon: FileText,
      badgeClass: 'bg-destructive/15 text-destructive',
    };
  }
  if (EXT_SETS.doc.has(rawExt) || mime.includes('word') || mime.includes('opendocument.text')) {
    return {
      ext,
      label: 'Документ',
      Icon: FileText,
      badgeClass: 'bg-primary/15 text-primary',
    };
  }
  if (EXT_SETS.sheet.has(rawExt) || mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') {
    return {
      ext,
      label: 'Таблица',
      Icon: FileSpreadsheet,
      badgeClass: 'bg-success/15 text-success',
    };
  }
  if (EXT_SETS.archive.has(rawExt) || mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) {
    return {
      ext,
      label: 'Архив',
      Icon: FileArchive,
      badgeClass: 'bg-warning/15 text-warning',
    };
  }
  if (EXT_SETS.video.has(rawExt) || mime.startsWith('video/')) {
    return {
      ext,
      label: 'Видео',
      Icon: Film,
      badgeClass: 'bg-approval-soft text-approval-ink',
    };
  }
  if (EXT_SETS.audio.has(rawExt) || mime.startsWith('audio/')) {
    return {
      ext,
      label: 'Аудио',
      Icon: FileAudio,
      badgeClass: 'bg-approval-soft text-approval-ink',
    };
  }
  if (EXT_SETS.code.has(rawExt) || mime.startsWith('text/')) {
    return {
      ext,
      label: 'Текст',
      Icon: FileCode,
      badgeClass: 'bg-background/80 text-foreground/80',
    };
  }
  return {
    ext,
    label: 'Файл',
    Icon: File,
    badgeClass: 'bg-background/80 text-muted-foreground',
  };
}

// Галерея фотографий и карточек документов в комментарии (Обсуждение и LIVE).
// В комментариях и чате рамок нет (правило C4): карточки отделяются мягкой заливкой и скруглением.
export function CommentAttachments({
  attachments,
  onPreview,
  className,
}: {
  attachments: readonly TaskAttachment[];
  onPreview: (attachment: TaskAttachment) => void;
  className?: string;
}): React.ReactElement | null {
  if (attachments.length === 0) return null;

  const images = attachments.filter((att) => isImageFile(att.mimeType, att.filename));
  const files = attachments.filter((att) => !isImageFile(att.mimeType, att.filename));

  return (
    <div className={cn('mbs-2 flex flex-col gap-2', className)}>
      {images.length > 0 && (
        <div
          className={cn(
            images.length === 1
              ? 'flex'
              : images.length === 2
                ? 'grid max-w-md grid-cols-2 gap-2'
                : 'grid max-w-lg grid-cols-2 gap-2 sm:grid-cols-3',
          )}
        >
          {images.map((att) => {
            const single = images.length === 1;
            const progress = att.uploadProgress ?? 0;
            return (
              <div
                key={att.id}
                className={cn(
                  'group/img relative overflow-hidden rounded-2xl bg-muted/60',
                  single ? 'max-w-full sm:max-w-sm' : 'aspect-[4/3] w-full',
                )}
              >
                <button
                  type="button"
                  onClick={() => onPreview(att)}
                  aria-label={`Открыть ${att.filename}`}
                  className={cn(
                    'block text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                    single ? 'max-w-full' : 'size-full',
                  )}
                >
                  {att.url ? (
                    <img
                      src={att.url}
                      alt={att.filename}
                      loading="lazy"
                      decoding="async"
                      className={cn(
                        'motion-safe:transition-transform duration-200 motion-safe:group-hover/img:scale-[1.02]',
                        single
                          ? 'max-h-72 w-auto max-w-full rounded-2xl object-contain'
                          : 'size-full object-cover',
                        att.uploading && 'opacity-85',
                      )}
                    />
                  ) : (
                    <div className="grid h-36 w-52 place-items-center bg-muted text-xs text-muted-foreground">
                      {att.filename}
                    </div>
                  )}
                </button>

                {/* Плашка описания и кнопка скачивания при наведении */}
                {!att.uploading && att.url && (
                  <>
                    <a
                      href={att.url}
                      download={att.filename}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Скачать ${att.filename}`}
                      title={`Скачать ${att.filename}`}
                      className=" absolute end-2 inset-bs-2 grid size-7 place-items-center rounded-full bg-background/85 text-foreground opacity-0 shadow-sm backdrop-blur-xs transition-opacity group-hover/img:opacity-100 focus-visible:opacity-100 hover:bg-background"
                    >
                      <Download className="size-3.5" />
                    </a>
                    <div className="pointer-events-none absolute inset-x-0 inset-be-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-2.5 pbe-2 pbs-5 text-2xs text-white opacity-0 transition-opacity group-hover/img:opacity-100">
                      <span className="truncate font-medium">{att.filename}</span>
                      {att.sizeBytes > 0 && (
                        <span className="shrink-0 tabular-nums text-white/80">
                          {formatBytes(att.sizeBytes)}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* Индикатор догрузки вложения прямо поверх превью */}
                {att.uploading && (
                  <>
                    <div className="pointer-events-none absolute inset-x-2 inset-be-2 flex items-center gap-1.5 rounded-xl bg-background/90 px-2.5 py-1 text-2xs font-medium text-foreground shadow-sm backdrop-blur-xs">
                      <Loader2 className="size-3 shrink-0 text-primary motion-safe:animate-spin" />
                      <span className="truncate">Загрузка</span>
                      <span className="ms-auto shrink-0 tabular-nums text-muted-foreground">
                        {progress}%
                      </span>
                    </div>
                    <div className="pointer-events-none absolute inset-x-0 inset-be-0 h-1 bg-background/50">
                      <div
                        className="h-full bg-primary transition-[width] duration-150"
                        style={{ width: `${Math.max(6, Math.min(100, progress))}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((att) => {
            const meta = fileKindMeta(att.filename, att.mimeType);
            const Icon = meta.Icon;
            const canPreview =
              !att.uploading &&
              Boolean(att.url) &&
              (isDocxFile(att.mimeType, att.filename) || isMp4File(att.mimeType, att.filename));
            const progress = att.uploadProgress ?? 0;

            const content = (
              <>
                <div
                  className={cn(
                    'flex size-10 shrink-0 flex-col items-center justify-center rounded-xl',
                    meta.badgeClass,
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="text-[9px] font-bold leading-none tracking-tight">
                    {meta.ext}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground" title={att.filename}>
                    {att.filename}
                  </div>
                  <div className="mbs-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <span>{meta.label}</span>
                    {att.sizeBytes > 0 && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{formatBytes(att.sizeBytes)}</span>
                      </>
                    )}
                    {att.uploading && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="font-medium text-primary tabular-nums">
                          Загрузка {progress}%
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {att.uploading ? (
                  <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-background/70 text-primary">
                    <Loader2 className="size-4 motion-safe:animate-spin" />
                  </div>
                ) : canPreview ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <span
                      className="grid size-8 place-items-center rounded-xl bg-background/70 text-muted-foreground transition-colors group-hover/doc:bg-background group-hover/doc:text-foreground"
                      title="Предпросмотр"
                    >
                      <Eye className="size-3.5" />
                    </span>
                    <a
                      href={att.url}
                      download={att.filename}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Скачать ${att.filename}`}
                      title={`Скачать ${att.filename}`}
                      className="grid size-8 place-items-center rounded-xl bg-background/70 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    >
                      <Download className="size-3.5" />
                    </a>
                  </div>
                ) : (
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-background/70 text-muted-foreground transition-colors group-hover/doc:bg-background group-hover/doc:text-foreground">
                    <Download className="size-3.5" />
                  </span>
                )}
                {att.uploading && (
                  <div className="pointer-events-none absolute inset-x-0 inset-be-0 h-0.5 bg-primary/15">
                    <div
                      className="h-full bg-primary transition-[width] duration-150"
                      style={{ width: `${Math.max(6, Math.min(100, progress))}%` }}
                    />
                  </div>
                )}
              </>
            );

            const cardClass =
              'group/doc relative flex min-w-[210px] max-w-xs items-center gap-2.5 overflow-hidden rounded-2xl bg-muted/70 px-3 py-2 text-start transition-colors hover:bg-muted';

            if (att.uploading) {
              return (
                <div key={att.id} className={cardClass}>
                  {content}
                </div>
              );
            }

            if (canPreview) {
              return (
                <div
                  key={att.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPreview(att)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onPreview(att);
                    }
                  }}
                  aria-label={`Открыть ${att.filename}`}
                  className={cn(
                    cardClass,
                    'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                  )}
                >
                  {content}
                </div>
              );
            }

            return (
              <a
                key={att.id}
                href={att.url}
                download={att.filename}
                className={cn(
                  cardClass,
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                )}
              >
                {content}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
