import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { SANITIZE_SCHEMA, applyInlineMarkSyntax } from './markdownSchema';

// Disable block constructs at the parser: titles like "---" or "- item" stay
// literal without sacrificing inline emphasis or introducing invisible characters.
function remarkInline(this: { data: () => object }): void {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  (data.micromarkExtensions ??= []).push({ disable: { null: [
    'headingAtx', 'setextUnderline', 'thematicBreak', 'list', 'blockQuote',
    'codeFenced', 'codeIndented', 'htmlFlow', 'definition',
  ] } });
}

export const InlineMarkdown = memo(function InlineMarkdown({ children }: { children: string }): React.ReactElement {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkInline]}
    rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
    allowedElements={['p', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'mark', 'span', 'a', 'img', 'br']}
    unwrapDisallowed
    components={{
      p: ({ children }) => <>{children}</>,
      // Titles often live inside a link/button: do not nest interactive elements.
      a: ({ children }) => <span>{children}</span>,
      img: ({ alt }) => <>{alt}</>,
      br: () => <> </>,
    }}
  >{applyInlineMarkSyntax(children)}</ReactMarkdown>;
});
