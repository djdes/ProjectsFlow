import { cn } from '@/lib/utils';
import { parseTitleHeading } from '@/lib/taskTitleBody';
import { InlineMarkdown } from '@/presentation/components/markdown/InlineMarkdown';

// Titles preserve authored inline marks while keeping list/rule-like text literal.
// Bold (`**…**`) takes the title's own weight by default: in lists and tables a title is
// already emphasised, and composer-made titles (wrapped in `**`) must not look heavier than
// hand-written ones. `authoredBold` renders it semibold instead: cards keep plain text regular
// and emphasise exactly what the author marked.
export function TaskTitleText({
  title,
  className,
  inline = false,
  authoredBold = false,
}: {
  title: string;
  className?: string;
  inline?: boolean;
  authoredBold?: boolean;
}): React.ReactElement | null {
  const text = parseTitleHeading(title).text.trim();
  if (!text) return null;
  const Tag = inline ? 'span' : 'p';
  const bold = authoredBold
    ? '[&_strong]:font-semibold [&_b]:font-semibold'
    : '[&_strong]:[font-weight:inherit] [&_b]:[font-weight:inherit]';
  return <Tag className={cn('text-sm leading-snug [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_mark]:rounded-sm [&_mark]:bg-manual-soft [&_mark]:text-inherit', bold, className)}><InlineMarkdown>{text}</InlineMarkdown></Tag>;
}
