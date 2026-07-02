import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ImageIcon, Trash2, X } from 'lucide-react';

// NodeView блок-картинки (без подписи). Состояния:
//  • uploading → плейсхолдер: иконка картинки + горизонтальный прогресс-бар (progress 0..100).
//  • загружено → картинка. Клик по картинке → лайтбокс на весь экран; на hover — кнопка удаления.
// Картинка выровнена по ЛЕВОМУ краю (items-start), чтобы drag-ручка «6 точек» слева
// вставала ровно к её краю. Отступ сверху/снизу симметричный и небольшой (my-2).
export function FigureImageView({ node, deleteNode }: NodeViewProps): React.ReactElement {
  const uploading = node.attrs.uploading as boolean;
  const progress = Math.min(100, Math.max(0, (node.attrs.progress as number) ?? 0));
  const src = (node.attrs.src as string) ?? '';
  const [lightbox, setLightbox] = React.useState(false);

  return (
    <NodeViewWrapper data-figure-image="" className="my-2 flex flex-col items-start">
      {uploading ? (
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
      ) : (
        <div className="group/img relative inline-block max-w-full" contentEditable={false}>
          <img
            src={src}
            alt=""
            draggable={false}
            onClick={() => setLightbox(true)}
            className="my-0 block max-h-[70vh] max-w-full cursor-zoom-in rounded-xl border border-border object-contain"
          />
          <button
            type="button"
            aria-label="Удалить картинку"
            title="Удалить"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              deleteNode();
            }}
            className="absolute right-2 top-2 hidden size-7 items-center justify-center rounded-md bg-background/85 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-background hover:text-destructive group-hover/img:flex"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}

      {/* Лайтбокс — ВЛОЖЕННЫЙ Radix-диалог. Radix делает его верхним слоем: клик по тёмной
          области/крестику закрывает ТОЛЬКО лайтбокс (родительское окно «Новая задача»/дровер
          остаются открытыми — нижние слои не реагируют, пока открыт верхний). Заодно решает
          pointer-events (портал в body под модалкой был некликабельным) и Escape. */}
      <DialogPrimitive.Root open={lightbox} onOpenChange={setLightbox}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
          <DialogPrimitive.Content
            data-figure-lightbox=""
            aria-describedby={undefined}
            // Тёмная область = весь Content поверх оверлея. Клик по ней (мимо картинки) закрывает.
            onClick={() => setLightbox(false)}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 focus:outline-none"
          >
            <DialogPrimitive.Title className="sr-only">Просмотр изображения</DialogPrimitive.Title>
            <img
              src={src}
              alt=""
              className="max-h-[90vh] max-w-[92vw] object-contain"
              onClick={(e) => e.stopPropagation()}
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
