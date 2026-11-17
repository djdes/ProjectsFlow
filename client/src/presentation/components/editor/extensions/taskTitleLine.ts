import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// The first line of a task text is its title (splitTitleBody on cards uses the same rule).
// A text written as «Title⏎Body» is ONE paragraph — the markdown soft break stays a «\n» in
// the text (shown as a line break by pre-wrap) or becomes a hard break — so styling the first
// paragraph made the whole body look like the title. This range — the first paragraph up to
// its first line break — is decorated instead; the document itself is not touched, so opening
// a task never rewrites its markdown.
export function titleLineRange(doc: PmNode): { from: number; to: number } | null {
  const first = doc.firstChild;
  if (!first || first.type.name !== 'paragraph' || first.content.size === 0) return null;
  let end = first.content.size;
  let found = false;
  first.forEach((node, offset) => {
    if (found) return;
    if (node.type.name === 'hardBreak') {
      end = offset;
      found = true;
    } else if (node.isText) {
      const at = (node.text ?? '').indexOf('\n');
      if (at >= 0) {
        end = offset + at;
        found = true;
      }
    }
  });
  // Paragraph content starts one position after the paragraph's opening token.
  return end > 0 ? { from: 1, to: 1 + end } : null;
}

const key = new PluginKey('pfTaskTitleLine');

export const TASK_TITLE_LINE_CLASS = 'pf-task-title-line';

export const TaskTitleLine = Extension.create({
  name: 'pfTaskTitleLine',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const range = titleLineRange(state.doc);
            if (!range) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: TASK_TITLE_LINE_CLASS }),
            ]);
          },
        },
      }),
    ];
  },
});
