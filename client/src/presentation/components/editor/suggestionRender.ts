import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';

import { SuggestionList, type SuggestionListHandle, type SuggestionItem } from './SuggestionList';

// Общая фабрика suggestion.render для slash-меню и @-упоминаний: монтирует SuggestionList
// в fixed-контейнер у курсора (props.clientRect), прокидывает клавиатуру и обновления.
export function createSuggestionRender(): NonNullable<SuggestionOptions<SuggestionItem>['render']> {
  return () => {
    let component: ReactRenderer<SuggestionListHandle> | null = null;
    let el: HTMLDivElement | null = null;

    const place = (rect: SuggestionProps['clientRect']): void => {
      if (!el || !rect) return;
      const r = rect();
      if (!r) return;
      el.style.position = 'fixed';
      el.style.left = `${Math.round(r.left)}px`;
      el.style.top = `${Math.round(r.bottom + 6)}px`;
      el.style.zIndex = '60';
    };

    return {
      onStart: (props: SuggestionProps<SuggestionItem>) => {
        component = new ReactRenderer(SuggestionList, {
          props: { items: props.items, command: props.command },
          editor: props.editor,
        });
        el = document.createElement('div');
        el.appendChild(component.element);
        document.body.appendChild(el);
        place(props.clientRect);
      },
      onUpdate: (props: SuggestionProps<SuggestionItem>) => {
        component?.updateProps({ items: props.items, command: props.command });
        place(props.clientRect);
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === 'Escape') return true;
        return component?.ref?.onKeyDown(props.event) ?? false;
      },
      onExit: () => {
        el?.remove();
        el = null;
        component?.destroy();
        component = null;
      },
    };
  };
}
