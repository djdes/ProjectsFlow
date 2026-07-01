import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FigureImageView } from './FigureImageView';

// Блок-картинка с подписью снизу (à la Notion): <figure><img><figcaption>подпись</figcaption></figure>.
// Хранение — как inline-HTML в markdown-описании (симметрично TextStyle.renderMarkdown), чтобы
// round-trip markdown↔doc не терял картинку и её ПОЗИЦИЮ. Воркер читает описание и видит, после
// какого абзаца стоит скрин и какая у него подпись (alt/figcaption).
//
// Загрузка: пока грузится — attrs.uploading=true + progress(0..100) → NodeView рисует плейсхолдер
// с прогресс-баром. uploadId — для адресного обновления ноды из paste-обработчика. uploading/
// progress/uploadId — транзиентные (rendered:false), в HTML/markdown не попадают.

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const FigureImage = Node.create({
  name: 'figureImage',
  group: 'block',
  content: 'inline*', // редактируемая подпись
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      src: { default: null as string | null },
      uploading: { default: false, rendered: false },
      progress: { default: 0, rendered: false },
      uploadId: { default: null as string | null, rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-figure-image]',
        contentElement: 'figcaption',
        getAttrs: (el) => ({
          src: (el as HTMLElement).querySelector('img')?.getAttribute('src') ?? null,
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes({ 'data-figure-image': '' }, HTMLAttributes),
      ['img', { src: (node.attrs.src as string) ?? '', alt: '' }],
      ['figcaption', 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureImageView);
  },

  // getMarkdown() — сериализуем ТОЛЬКО загруженные (src задан); плейсхолдеры загрузки не пишем.
  renderMarkdown(node: JSONContent, helpers: { renderChildren: (n: JSONContent[]) => string }) {
    const src = (node.attrs?.src as string) ?? '';
    if (!src) return '';
    const caption = helpers.renderChildren(node.content ?? []).replace(/\s+/g, ' ').trim();
    return `\n<figure data-figure-image><img src="${esc(src)}" alt="${esc(caption)}" /><figcaption>${esc(caption)}</figcaption></figure>\n`;
  },
});
