import { cn } from '@/lib/utils';
import { parseTitleHeading } from '@/lib/taskTitleBody';
import { InlineMarkdown } from '@/presentation/components/markdown/InlineMarkdown';

// Titles preserve authored inline marks while keeping list/rule-like text literal.
export function TaskTitleText({
  title,
  className,
  inline = false,
}: {
  title: string;
  className?: string;
  inline?: boolean;
}): React.ReactElement | null {
  const text = parseTitleHeading(title).text.trim();
  if (!text) return null;
  const Tag = inline ? 'span' : 'p';
  return <Tag className={cn('text-sm leading-snug [&_strong]:font-bold [&_b]:font-bold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_mark]:rounded-sm [&_mark]:bg-yellow-200/60 [&_mark]:text-inherit', className)}><InlineMarkdown>{text}</InlineMarkdown></Tag>;
}
