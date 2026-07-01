import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { ImageIcon } from 'lucide-react';

// NodeView блок-картинки. Два состояния:
//  • uploading → плейсхолдер: иконка картинки + горизонтальный прогресс-бар (progress 0..100).
//  • загружено → сама картинка + редактируемая подпись снизу (figcaption, placeholder «добавить подпись»).
export function FigureImageView({ node, editor }: NodeViewProps): React.ReactElement {
  const uploading = node.attrs.uploading as boolean;
  const progress = Math.min(100, Math.max(0, (node.attrs.progress as number) ?? 0));
  const src = (node.attrs.src as string) ?? '';
  const captionEmpty = node.content.size === 0;

  return (
    <NodeViewWrapper
      data-figure-image=""
      className="group/figure my-3 flex flex-col items-center"
    >
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
        <img
          src={src}
          alt=""
          draggable={false}
          contentEditable={false}
          className="max-h-[70vh] max-w-full rounded-xl border border-border object-contain"
        />
      )}
      <NodeViewContent
        // NodeViewContent.as типизирован узко ('div'); фактически принимает любой тег.
        as={'figcaption' as 'div'}
        data-placeholder="добавить подпись"
        className={
          'mt-2 w-full max-w-full text-center text-sm text-muted-foreground outline-none' +
          (captionEmpty && editor.isEditable
            ? " before:pointer-events-none before:text-muted-foreground/50 before:content-[attr(data-placeholder)]"
            : '')
        }
      />
    </NodeViewWrapper>
  );
}
