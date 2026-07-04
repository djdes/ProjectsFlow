import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Notion-style: только что перетащенный блок подсвечивается мягким пастельно-синим фоном,
// пока пользователь не кликнет/не начнёт печатать в другом месте. Ловим drop по мете
// `uiEvent === 'drop'` (её ставит ProseMirror на drop-транзакции), декорируем блок под
// текущим выделением и снимаем подсветку на следующей же смене выделения/правке.

const key = new PluginKey<DecorationSet>('blockMovedHighlight');

// Диапазон верхнеуровневого блока, в котором стоит позиция `pos`.
function blockRangeAt(doc: import('@tiptap/pm/model').Node, pos: number): { from: number; to: number } | null {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  const depth = $pos.depth === 0 ? 0 : 1;
  const from = $pos.before(depth || 1);
  const node = doc.nodeAt(from);
  if (!node) return null;
  return { from, to: from + node.nodeSize };
}

export const BlockMovedHighlight = Extension.create({
  name: 'blockMovedHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            // Транзакция-дроп: подсвечиваем перемещённый блок (он под текущим выделением).
            if (tr.getMeta('uiEvent') === 'drop') {
              const sel = tr.selection;
              const range =
                sel instanceof NodeSelection
                  ? { from: sel.from, to: sel.to }
                  : blockRangeAt(tr.doc, sel.from);
              if (!range) return DecorationSet.empty;
              return DecorationSet.create(tr.doc, [
                Decoration.node(range.from, range.to, { class: 'pf-block-moved' }),
              ]);
            }
            // Есть активная подсветка и юзер сменил выделение/правил текст — снимаем.
            const hasHighlight = old.find().length > 0;
            if (hasHighlight && (tr.selectionSet || tr.docChanged)) {
              return DecorationSet.empty;
            }
            // Иначе — просто переносим декорации через изменения документа.
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});
