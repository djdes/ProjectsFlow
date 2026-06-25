// Strip Markdown syntax down to readable plain text. Used where we show a one-line
// preview/excerpt and must NOT leak raw markup (e.g. sidebar "Recents"): no **, #, `, [], etc.
// This is intentionally lightweight (regex-based) — not a full parser.

export function markdownToPlain(md: string | null | undefined): string {
  if (!md) return '';
  let s = md;

  // Fenced code blocks → drop fences, keep inner text on one line.
  s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, ' $1 ');
  // Inline code `x` → x
  s = s.replace(/`([^`]+)`/g, '$1');
  // Images ![alt](url) → alt
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Headings / blockquote markers at line start
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s{0,3}>\s?/gm, '');
  // Checkbox + list markers at line start
  s = s.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  // Emphasis / bold / strike / highlight / underline
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/_([^_]+)_/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  s = s.replace(/==([^=]+)==/g, '$1');
  s = s.replace(/<\/?u>/gi, '');
  // HTML comments (e.g. ralph markers) and stray tags
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
