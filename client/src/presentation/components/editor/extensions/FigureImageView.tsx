import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { AlertTriangle, ImageIcon, Trash2, X } from 'lucide-react';

// Block image node. A pasted screenshot is rendered from a local blob URL immediately; upload
// progress is drawn over it. Once the server URL arrives it replaces the transient preview.
export function FigureImageView({ node, deleteNode }: NodeViewProps): React.ReactElement {
  const uploading = node.attrs.uploading as boolean;
  const uploadError = node.attrs.uploadError as boolean;
  const progress = Math.min(100, Math.max(0, (node.attrs.progress as number) ?? 0));
  const src = (node.attrs.src as string) ?? '';
  const previewSrc = (node.attrs.previewSrc as string) ?? '';
  const displaySrc = src || previewSrc;
  const [failedSrc, setFailedSrc] = React.useState('');
  const displayError = Boolean(displaySrc) && failedSrc === displaySrc;
  const [lightbox, setLightbox] = React.useState(false);

  const deleteButton = (
    <button
      type="button"
      aria-label="Удалить картинку"
      title="Удалить"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteNode();
      }}
      className="absolute right-2 top-2 hidden size-7 items-center justify-center rounded-md bg-background/85 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-background hover:text-destructive group-hover/img:flex"
    >
      <Trash2 className="size-4" />
    </button>
  );

  return (
    <NodeViewWrapper data-figure-image="" className="my-2 flex flex-col items-start">
      {uploading && !displaySrc ? (
        <div
          className="flex w-full flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-10"
          contentEditable={false}
        >
          <ImageIcon className="size-7 text-muted-foreground/60" aria-hidden />
          <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : displaySrc && !displayError ? (
        <div className="group/img relative inline-block max-w-full" contentEditable={false}>
          <img
            src={displaySrc}
            alt=""
            draggable={false}
            onLoad={() => setFailedSrc('')}
            onError={() => setFailedSrc(displaySrc)}
            onClick={() => {
              if (!uploading) setLightbox(true);
            }}
            className={`my-0 block max-h-[70vh] max-w-full rounded-xl border border-border object-contain ${
              uploading ? 'cursor-default opacity-90' : 'cursor-zoom-in'
            }`}
          />
          {uploading ? (
            <div className="absolute inset-x-3 bottom-3 overflow-hidden rounded-full bg-black/25 p-0.5 backdrop-blur-sm">
              <div
                className="h-1.5 rounded-full bg-primary transition-[width] duration-200 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
          {uploadError ? (
            <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground shadow-sm">
              <AlertTriangle className="size-3.5 shrink-0" />
              Не удалось загрузить изображение
            </div>
          ) : null}
          {deleteButton}
        </div>
      ) : (
        <div
          className="group/img relative flex min-h-24 w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-10 py-6 text-sm text-destructive"
          contentEditable={false}
        >
          <AlertTriangle className="size-5 shrink-0" />
          Не удалось показать изображение
          {deleteButton}
        </div>
      )}

      <DialogPrimitive.Root open={lightbox && !displayError} onOpenChange={setLightbox}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
          <DialogPrimitive.Content
            data-figure-lightbox=""
            aria-describedby={undefined}
            onClick={() => setLightbox(false)}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 focus:outline-none"
          >
            <DialogPrimitive.Title className="sr-only">Просмотр изображения</DialogPrimitive.Title>
            <img
              src={displaySrc}
              alt=""
              className="max-h-[90vh] max-w-[92vw] object-contain"
              onClick={(event) => event.stopPropagation()}
            />
            <DialogPrimitive.Close
              aria-label="Закрыть"
              className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </NodeViewWrapper>
  );
}
