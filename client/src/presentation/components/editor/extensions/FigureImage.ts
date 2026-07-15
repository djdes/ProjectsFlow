import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FigureImageView } from './FigureImageView';

// Блок-картинка (à la Notion): <figure data-figure-image><img></figure> — без подписи.
// Хранение — как inline-HTML в markdown-описании (симметрично TextStyle.renderMarkdown), чтобы
// round-trip markdown↔doc не терял картинку и её ПОЗИЦИЮ. Воркер читает описание и видит, после
// какого абзаца стоит скрин.
//
// Загрузка: пока грузится — attrs.uploading=true + progress(0..100) → NodeView рисует плейсхолдер
// с прогресс-баром. uploadId — для адресного обновления ноды из paste-обработчика. uploading/
// progress/uploadId — транзиентные (rendered:false), в HTML/markdown не попадают.

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const FigureImage = Node.create({
  name: 'figureImage',
  group: 'block',
  atom: true, // цельный блок без редактируемого содержимого (подпись убрана)
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      src: { default: null as string | null },
      uploading: { default: false, rendered: false },
      progress: { default: 0, rendered: false },
      uploadId: { default: null as string | null, rendered: false },
      previewSrc: { default: null as string | null, rendered: false },
      uploadError: { default: false, rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        // Старый формат мог иметь <figcaption> — игнорируем, парсим только src картинки.
        tag: 'figure[data-figure-image]',
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
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureImageView);
  },

  // getMarkdown() — сериализуем ТОЛЬКО загруженные (src задан); плейсхолдеры загрузки не пишем.
  renderMarkdown(node: JSONContent) {
    const src = (node.attrs?.src as string) ?? '';
    if (!src) return '';
    return `\n<figure data-figure-image><img src="${esc(src)}" alt="" /></figure>\n`;
  },
});
