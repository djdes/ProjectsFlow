import { lazy, Suspense, useRef } from 'react';
import { TaskTitleText } from './TaskTitleText';

const RichTextEditor = lazy(() => import('../editor/RichTextEditor').then(m => ({ default: m.RichTextEditor })));

/** Inline rename uses the same Markdown editor, so changing words keeps their marks. */
export function TaskTitleEditor({ value, onChange, onCommit, onEnter, onCancel, disabled, errorId, className }: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onEnter?: () => void;
  onCancel: () => void;
  disabled?: boolean;
  errorId?: string;
  className?: string;
}): React.ReactElement {
  const finished = useRef(false);
  return <div className={className} onClick={e => e.stopPropagation()} aria-describedby={errorId}>
    <Suspense fallback={<TaskTitleText title={value} />}>
      <RichTextEditor value={value} variant="title" autoFocus disabled={disabled}
        onChange={next => { finished.current = false; onChange(next.replace(/\n+/g, ' ')); }}
        onSubmit={() => { if (finished.current || disabled) return; (onEnter ?? onCommit)(); }}
        onBlur={() => { if (!finished.current && !disabled) onCommit(); }}
        onEscape={() => { finished.current = true; onCancel(); }}
        placeholder="Название задачи"
        className="[&_.tiptap]:min-h-6 [&_.tiptap]:text-sm [&_.tiptap]:font-medium [&_.tiptap_p]:m-0 [&_.tiptap_h1]:m-0 [&_.tiptap_h1]:text-sm [&_.tiptap_h2]:m-0 [&_.tiptap_h2]:text-sm [&_.tiptap_h3]:m-0 [&_.tiptap_h3]:text-sm"
      />
    </Suspense>
  </div>;
}
